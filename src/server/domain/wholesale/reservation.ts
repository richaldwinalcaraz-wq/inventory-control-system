import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export class InsufficientAvailableToPromiseError extends Error {}

const RESERVATION_TTL_DAYS = 3; // client-decisions-needed.md #3's recommended default

/**
 * Lazily-upserted-then-FOR-UPDATE mutex row, scoped per (variant, branch) —
 * the fix for a real write-skew bug locking stock_balance rows alone can't
 * prevent: two concurrent order-confirmations could both read the same
 * (correct, stale-free) ATP and both insert a reservation, since there's no
 * existing row for two competing INSERTs to contend on. Every reservation-
 * creating transaction must call this before computing ATP and inserting.
 */
export async function lockReservationRow(
  tx: Prisma.TransactionClient,
  params: { productVariantId: string; branchId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO stock_reservation_lock (product_variant_id, branch_id) VALUES (${params.productVariantId}, ${params.branchId})
    ON CONFLICT (product_variant_id, branch_id) DO NOTHING
  `;
  await tx.$queryRaw`
    SELECT product_variant_id FROM stock_reservation_lock
    WHERE product_variant_id = ${params.productVariantId} AND branch_id = ${params.branchId}
    FOR UPDATE
  `;
}

/**
 * Available-to-promise = SUM(stock_balance.quantity_on_hand across every
 * location in the branch) − SUM(active, non-expired reservations) for this
 * variant/branch. Caller must hold lockReservationRow first.
 */
export async function computeAvailableToPromise(
  tx: Prisma.TransactionClient,
  params: { productVariantId: string; branchId: string },
): Promise<number> {
  const balanceRows = await tx.$queryRaw<{ sum: string | null }[]>`
    SELECT SUM(sb.quantity_on_hand)::text as sum FROM stock_balance sb
    JOIN warehouse_location wl ON wl.id = sb.warehouse_location_id
    JOIN warehouse w ON w.id = wl.warehouse_id
    WHERE sb.product_variant_id = ${params.productVariantId} AND w.branch_id = ${params.branchId}
  `;
  const onHand = Number(balanceRows[0]?.sum ?? 0);

  const reservedRows = await tx.$queryRaw<{ sum: string | null }[]>`
    SELECT SUM(qty)::text as sum FROM stock_reservation
    WHERE product_variant_id = ${params.productVariantId} AND branch_id = ${params.branchId}
      AND status = 'ACTIVE' AND expires_at > now()
  `;
  const reserved = Number(reservedRows[0]?.sum ?? 0);

  return onHand - reserved;
}

/**
 * Locks, checks ATP, and inserts a reservation for one line — all inside
 * the caller's transaction. Throws if ATP is insufficient rather than
 * silently partially reserving.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  params: { branchId: string; productVariantId: string; referenceType: string; referenceId: string; qty: number },
): Promise<{ id: string; expiresAt: Date }> {
  await lockReservationRow(tx, { productVariantId: params.productVariantId, branchId: params.branchId });

  const atp = await computeAvailableToPromise(tx, { productVariantId: params.productVariantId, branchId: params.branchId });
  if (atp < params.qty) {
    throw new InsufficientAvailableToPromiseError(
      `Cannot reserve ${params.qty} of product ${params.productVariantId} at branch ${params.branchId} — only ${atp} available to promise.`,
    );
  }

  const expiresAt = new Date(Date.now() + RESERVATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const reservation = await tx.stockReservation.create({
    data: {
      id: randomUUID(),
      branchId: params.branchId,
      productVariantId: params.productVariantId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      qty: params.qty,
      status: "ACTIVE",
      expiresAt,
    },
  });

  return { id: reservation.id, expiresAt: reservation.expiresAt };
}

/**
 * Stale-reservation re-validation for the RESERVED -> PICKING transition
 * (Picking List issuance) — re-checks expiresAt > now() at this later point
 * too, not only when the reservation was first created. Without this, an
 * order whose reservation quietly expired mid-backlog could proceed into
 * picking in parallel with a second order that validly re-reserved the
 * same stock, with the negative-stock guard only catching the collision at
 * whichever order posts second.
 */
export async function reservationsStillActive(
  tx: Prisma.TransactionClient,
  params: { referenceType: string; referenceId: string },
): Promise<boolean> {
  const reservations = await tx.stockReservation.findMany({
    where: { referenceType: params.referenceType, referenceId: params.referenceId, status: "ACTIVE" },
  });
  if (reservations.length === 0) return false;
  return reservations.every((r) => r.expiresAt.getTime() > Date.now());
}

export async function releaseReservations(
  tx: Prisma.TransactionClient,
  params: { referenceType: string; referenceId: string; toStatus: "CONSUMED" | "CANCELLED" | "EXPIRED" },
): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { referenceType: params.referenceType, referenceId: params.referenceId, status: "ACTIVE" },
    data: { status: params.toStatus },
  });
}
