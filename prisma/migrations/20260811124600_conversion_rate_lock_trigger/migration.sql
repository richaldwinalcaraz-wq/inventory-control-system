-- Belt-and-suspenders lock on conversion_rate_version, on top of the
-- app-layer check: once a version is referenced by a posted stock_ledger
-- row, it becomes immutable at the database layer too, even if the
-- application check is bypassed or has a bug.

-- 1. Reject ANY update to a row once locked_at is set (including attempts
--    to clear locked_at itself).
CREATE OR REPLACE FUNCTION reject_update_if_conversion_rate_locked()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'conversion_rate_version % is locked (locked_at=%) and cannot be modified', OLD.id, OLD.locked_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversion_rate_version_lock
BEFORE UPDATE ON conversion_rate_version
FOR EACH ROW
EXECUTE FUNCTION reject_update_if_conversion_rate_locked();

-- 2. Auto-lock a conversion_rate_version the instant a stock_ledger row
--    references it, independent of whether the application layer set
--    locked_at itself in the same transaction.
CREATE OR REPLACE FUNCTION lock_conversion_rate_on_ledger_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.conversion_rate_version_id IS NOT NULL THEN
    UPDATE conversion_rate_version
    SET locked_at = NEW.created_at
    WHERE id = NEW.conversion_rate_version_id
      AND locked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_ledger_lock_conversion_rate
AFTER INSERT ON stock_ledger
FOR EACH ROW
EXECUTE FUNCTION lock_conversion_rate_on_ledger_insert();
