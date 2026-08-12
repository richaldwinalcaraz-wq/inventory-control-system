/**
 * Single source of truth mapping every domain/application error class to
 * an HTTP status + machine-readable code. Centralized here rather than a
 * chain of instanceof checks copy-pasted into every route handler — one
 * new error class means one new line here, not N call sites.
 */
import { PermissionDeniedError } from "../domain/rbac/assertPermission";
import { DocumentNumberRangeError } from "../domain/documents/documentNumber";
import { ConversionRateVerificationError } from "../domain/catalog/conversionRate";
import { IdempotencyPayloadMismatchError, IdempotencyInProgressError, NegativeStockError } from "../domain/ledger/postLedgerEntry";
import { NoCostBasisError } from "../domain/ledger/currentUnitCost";
import { NoApprovalThresholdConfiguredError } from "../domain/approval/resolveRequiredApprover";
import { InvalidPinError, InvalidOrExpiredPinTokenError } from "../domain/session/pinToken";
import { SessionIdleError } from "../domain/session/idleLock";
import { NotAuthorizedToGrantElevationError } from "../domain/session/emergencyElevation";
import { OpeningBalanceLockedError, OpeningBalanceAlreadyPostedError } from "../domain/ledger/postOpeningBalance";
import {
  FuturePostingNotAllowedError,
  BackdatingLimitExceededError,
  SupervisorApprovalRequiredError,
  PeriodLockedError,
} from "../domain/period/validatePostingDate";
import { ChainIntegrityError } from "../domain/ledger/exportDailyHash";
import { ReceivingReportNotFoundError, InvalidReceivingReportStateError } from "../application/receiving/draft";
import {
  CountSlipAlreadySubmittedError,
  ReceiverCountMissingError,
  CheckerMustNotBeReceiverError,
  WitnessRequiredError,
  CountsDoNotDisagreeError,
} from "../application/receiving/counting";
import { SupervisorRequiredForRejectionError } from "../application/receiving/inspection";
import { BothCountSlipsRequiredError, VerifierMustNotBeReceiverError } from "../application/receiving/verification";
import { SupplierCallbackRequiredError, WrongApproverRoleError } from "../application/receiving/approval";
import { NotReadyForEncodingError, MissingFinalQuantitiesError, LivePhotoRequiredError } from "../application/receiving/encoding";
import { CannotVoidPostedReportError, MatchingGateExitOrOwnerRequiredError } from "../application/receiving/void";
import { RetailSaleNotFoundError, InvalidRetailSaleStateError, EmptyRetailSaleError } from "../application/retail/draft";
import { CannotVoidPostedRetailSaleError } from "../application/retail/void";
import { WarehouseLocationNotFoundError } from "../application/inventory/transfer";
import {
  AdjustmentRequestNotFoundError,
  InvalidAdjustmentStateError,
  ReconciliationNotesRequiredError,
  WrongAdjustmentDirectionError,
} from "../application/adjustment/request";
import { InvestigatorCannotBeRequesterError, AuditorReviewRequiredError } from "../application/adjustment/investigate";
import { RequesterCannotApproveOwnAdjustmentError, WrongAdjustmentApproverRoleError } from "../application/adjustment/approve";
import { NotReadyForAdjustmentPostingError } from "../application/adjustment/post";
import { CannotVoidPostedAdjustmentError } from "../application/adjustment/void";
import { InsufficientAvailableToPromiseError } from "../domain/wholesale/reservation";
import { NoEligibleSpotRecountWitnessError } from "../domain/wholesale/spotRecount";
import { SalesOrderNotFoundError, InvalidSalesOrderStateError, EmptySalesOrderError } from "../application/wholesale/order";
import { ReservationExpiredError } from "../application/wholesale/pick";
import { CheckerMustNotBePickerError, CountSlipAlreadySubmittedForOrderError } from "../application/wholesale/check";
import { SpotRecountNotRequiredError, SpotRecountAlreadySubmittedError } from "../application/wholesale/spotRecount";
import { SpotRecountRequiredError } from "../application/wholesale/authorizeRelease";
import { MissingUnitWeightError, ExceedsAvailableToReleaseError, EmptyReleaseError } from "../application/wholesale/release";
import { SalesOrderReleaseNotFoundError, InvalidReleaseStateError } from "../application/wholesale/gateCheck";
import { GateCheckPreconditionsNotMetError, NotReadyForReleasePostingError } from "../application/wholesale/post";
import { CannotVoidOrderWithReleasesError, CannotVoidPostedReleaseError } from "../application/wholesale/void";
import { UnauthenticatedError } from "./currentActor";
import { InvalidRequestBodyError } from "./parseBody";

const CATALOG: Array<[new (...args: never[]) => Error, number, string]> = [
  [UnauthenticatedError, 401, "UNAUTHENTICATED"],
  [InvalidRequestBodyError, 400, "INVALID_REQUEST_BODY"],
  [PermissionDeniedError, 403, "PERMISSION_DENIED"],
  [DocumentNumberRangeError, 409, "DOCUMENT_NUMBER_RANGE_EXCEEDED"],
  [ConversionRateVerificationError, 400, "CONVERSION_RATE_VERIFICATION_INVALID"],
  [IdempotencyPayloadMismatchError, 409, "IDEMPOTENCY_PAYLOAD_MISMATCH"],
  [IdempotencyInProgressError, 409, "IDEMPOTENCY_IN_PROGRESS"],
  [NoApprovalThresholdConfiguredError, 422, "NO_APPROVAL_THRESHOLD_CONFIGURED"],
  [InvalidPinError, 401, "INVALID_PIN"],
  [InvalidOrExpiredPinTokenError, 401, "INVALID_OR_EXPIRED_PIN_TOKEN"],
  [SessionIdleError, 401, "SESSION_IDLE"],
  [NotAuthorizedToGrantElevationError, 403, "NOT_AUTHORIZED"],
  [OpeningBalanceLockedError, 423, "OPENING_BALANCE_LOCKED"],
  [OpeningBalanceAlreadyPostedError, 409, "OPENING_BALANCE_ALREADY_POSTED"],
  [FuturePostingNotAllowedError, 422, "FUTURE_POSTING_NOT_ALLOWED"],
  [BackdatingLimitExceededError, 422, "BACKDATING_LIMIT_EXCEEDED"],
  [SupervisorApprovalRequiredError, 403, "SUPERVISOR_APPROVAL_REQUIRED"],
  [PeriodLockedError, 423, "PERIOD_LOCKED"],
  [ChainIntegrityError, 500, "CHAIN_INTEGRITY_BROKEN"],
  [ReceivingReportNotFoundError, 404, "NOT_FOUND"],
  [InvalidReceivingReportStateError, 409, "INVALID_STATE"],
  [CountSlipAlreadySubmittedError, 409, "ALREADY_SUBMITTED"],
  [ReceiverCountMissingError, 422, "RECEIVER_COUNT_MISSING"],
  [CheckerMustNotBeReceiverError, 403, "SOD_VIOLATION"],
  [WitnessRequiredError, 422, "WITNESS_REQUIRED"],
  [CountsDoNotDisagreeError, 422, "COUNTS_DO_NOT_DISAGREE"],
  [SupervisorRequiredForRejectionError, 403, "SUPERVISOR_REQUIRED"],
  [BothCountSlipsRequiredError, 422, "BOTH_COUNT_SLIPS_REQUIRED"],
  [VerifierMustNotBeReceiverError, 403, "SOD_VIOLATION"],
  [SupplierCallbackRequiredError, 422, "SUPPLIER_CALLBACK_REQUIRED"],
  [WrongApproverRoleError, 403, "WRONG_APPROVER_ROLE"],
  [NotReadyForEncodingError, 409, "NOT_READY_FOR_ENCODING"],
  [MissingFinalQuantitiesError, 422, "MISSING_FINAL_QUANTITIES"],
  [LivePhotoRequiredError, 422, "LIVE_PHOTO_REQUIRED"],
  [CannotVoidPostedReportError, 409, "CANNOT_VOID_POSTED"],
  [MatchingGateExitOrOwnerRequiredError, 403, "GATE_EXIT_OR_OWNER_REQUIRED"],
  [NegativeStockError, 409, "INSUFFICIENT_STOCK"],
  [NoCostBasisError, 422, "NO_COST_BASIS"],
  [WarehouseLocationNotFoundError, 422, "WAREHOUSE_LOCATION_NOT_CONFIGURED"],
  [RetailSaleNotFoundError, 404, "NOT_FOUND"],
  [InvalidRetailSaleStateError, 409, "INVALID_STATE"],
  [EmptyRetailSaleError, 400, "EMPTY_SALE"],
  [CannotVoidPostedRetailSaleError, 409, "CANNOT_VOID_POSTED"],
  [AdjustmentRequestNotFoundError, 404, "NOT_FOUND"],
  [InvalidAdjustmentStateError, 409, "INVALID_STATE"],
  [ReconciliationNotesRequiredError, 422, "RECONCILIATION_NOTES_REQUIRED"],
  [WrongAdjustmentDirectionError, 400, "WRONG_ADJUSTMENT_DIRECTION"],
  [InvestigatorCannotBeRequesterError, 403, "SOD_VIOLATION"],
  [AuditorReviewRequiredError, 403, "AUDITOR_REVIEW_REQUIRED"],
  [RequesterCannotApproveOwnAdjustmentError, 403, "SOD_VIOLATION"],
  [WrongAdjustmentApproverRoleError, 403, "WRONG_APPROVER_ROLE"],
  [NotReadyForAdjustmentPostingError, 409, "NOT_READY_FOR_POSTING"],
  [CannotVoidPostedAdjustmentError, 409, "CANNOT_VOID_POSTED"],
  [SalesOrderNotFoundError, 404, "NOT_FOUND"],
  [InvalidSalesOrderStateError, 409, "INVALID_STATE"],
  [EmptySalesOrderError, 400, "EMPTY_ORDER"],
  [InsufficientAvailableToPromiseError, 409, "INSUFFICIENT_ATP"],
  [ReservationExpiredError, 409, "RESERVATION_EXPIRED"],
  [CheckerMustNotBePickerError, 403, "SOD_VIOLATION"],
  [CountSlipAlreadySubmittedForOrderError, 409, "ALREADY_SUBMITTED"],
  [NoEligibleSpotRecountWitnessError, 403, "SOD_VIOLATION"],
  [SpotRecountNotRequiredError, 400, "SPOT_RECOUNT_NOT_REQUIRED"],
  [SpotRecountAlreadySubmittedError, 409, "ALREADY_SUBMITTED"],
  [SpotRecountRequiredError, 422, "SPOT_RECOUNT_REQUIRED"],
  [MissingUnitWeightError, 422, "MISSING_UNIT_WEIGHT"],
  [ExceedsAvailableToReleaseError, 409, "EXCEEDS_AVAILABLE_TO_RELEASE"],
  [EmptyReleaseError, 400, "EMPTY_RELEASE"],
  [SalesOrderReleaseNotFoundError, 404, "NOT_FOUND"],
  [InvalidReleaseStateError, 409, "INVALID_STATE"],
  [GateCheckPreconditionsNotMetError, 422, "GATE_CHECK_PRECONDITIONS_NOT_MET"],
  [NotReadyForReleasePostingError, 409, "NOT_READY_FOR_POSTING"],
  [CannotVoidOrderWithReleasesError, 409, "CANNOT_VOID_WITH_RELEASES"],
  [CannotVoidPostedReleaseError, 409, "CANNOT_VOID_POSTED"],
];

/** Falls back to 500/INTERNAL_ERROR for anything not in the catalog — never silently 200s an error. */
export function classifyError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof Error) {
    for (const [ErrorClass, status, code] of CATALOG) {
      if (err instanceof ErrorClass) {
        return { status, code, message: err.message };
      }
    }
    return { status: 500, code: "INTERNAL_ERROR", message: err.message };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred." };
}
