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
import { VoidWithoutReturnReasonRequiredError } from "../application/retail/voidWithoutReturn";
import { WarehouseLocationNotFoundError } from "../application/inventory/transfer";
import {
  AdjustmentRequestNotFoundError,
  InvalidAdjustmentStateError,
  ReconciliationNotesRequiredError,
  WrongAdjustmentDirectionError,
  DamageReportRequiredForAdj03Error,
} from "../application/adjustment/request";
import { InvestigatorCannotBeRequesterError, AuditorReviewRequiredError } from "../application/adjustment/investigate";
import { RequesterCannotApproveOwnAdjustmentError, WrongAdjustmentApproverRoleError } from "../application/adjustment/approve";
import { NotReadyForAdjustmentPostingError, DamageReportNotYetDisposedError } from "../application/adjustment/post";
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
import { DiscrepancyCaseNotFoundError, InvalidDiscrepancyCaseStateError, AssigneeRequiredError } from "../application/discrepancy/assign";
import { CaseNotAssignedError, ResolutionRequiredError } from "../application/discrepancy/close";
import {
  OriginalSaleLineNotFoundError,
  OriginalSaleNotEligibleForReturnError,
  InvalidReturnQuantityError,
  ExceedsRemainingReturnableQtyError,
  WrongReturnApproverRoleError,
} from "../application/returns/authorize";
import { ReturnAuthorizationNotFoundError, InvalidReturnAuthorizationStateError, ReturnAuthorizationExpiredError } from "../application/returns/receive";
import { ReturnCountAlreadySubmittedError, ReturnReceiveCountMissingError, ReturnCheckerMustNotBeReceiverError } from "../application/returns/count";
import {
  GradingEvidenceRequiredError,
  GraderCannotBeIssuerError,
  GraderMustDifferFromFirstGraderError,
  GradingAlreadySubmittedError,
  BothReturnCountsRequiredError,
  GradingIncompleteError,
} from "../application/returns/grade";
import { ReturnNotDisputedError } from "../application/returns/resolveDisagreement";
import {
  ReturnWarehouseLocationNotFoundError,
  AlreadyPostedError,
  NotReadyForReturnPostingError,
  ReturnMissingDocumentNumberError,
} from "../application/returns/post";
import { CannotVoidReceivedReturnError } from "../application/returns/void";
import { CauseRequiredError, InvalidDamageQuantityError } from "../application/disposal/report";
import { DamageReportNotFoundError, InvalidDamageReportStateError } from "../application/disposal/investigate";
import {
  ExceedsUndisposedQtyError,
  WitnessMustNotBeWarehouseRoleError,
  SameWitnessError,
  InvalidCertificateQuantityError,
} from "../application/disposal/createCertificate";
import {
  DisposalCertificateNotFoundError,
  InvalidDisposalCertificateStateError,
  WrongDispositionError,
  DestructionEvidenceRequiredError,
  NotReadyForDisposalPostingError,
} from "../application/disposal/destroy";
import {
  ScrapSaleAlreadyRecordedError,
  ScrapSaleJustificationRequiredError,
  ScrapBuyerBenchmarkNotFoundError,
  ScrapSaleRecordNotFoundError,
  ScrapSaleNotBelowBenchmarkError,
  ScrapSaleAlreadyApprovedError,
  WrongScrapSaleApproverRoleError,
  ScrapSaleApprovalRequiredError,
  QuoteEvidenceRequiredError,
} from "../application/disposal/scrapSale";
import { CannotVoidPostedDisposalCertificateError, VoidReasonRequiredError } from "../application/disposal/void";
import { NoBranchManagerConfiguredError, NoOwnerConfiguredError } from "../application/discrepancy/aging";
import {
  CycleCountWindowAlreadyActiveError,
  CycleCountWindowNotFoundError,
  CycleCountWindowNotActiveError,
  ExceptionReasonRequiredError,
} from "../application/cycleCount/window";
import {
  BranchLockedForCycleCountError,
  InvalidOrExpiredCycleCountWindowExceptionError,
} from "../domain/cycleCount/branchLock";
import { NoActiveCycleCountWindowError, CycleCountRecordAlreadyOpenError } from "../application/cycleCount/startCount";
import {
  CycleCountRecordNotFoundError,
  InvalidCycleCountRecordStateError,
  CycleCountSlipAlreadySubmittedError,
  PrimaryCountMissingError,
  SecondaryCounterMustNotBePrimaryError,
  WitnessRequiredError as CycleCountWitnessRequiredError,
  CollectorMustNotBeCounterError,
} from "../application/cycleCount/submitCount";
import { BothCountsRequiredError } from "../application/cycleCount/evaluate";
import { RecounterMustDifferFromPriorCountersError } from "../application/cycleCount/recount";
import { DailyReconciliationAlreadyPreparedError } from "../application/reconciliation/prepare";
import {
  DailyReconciliationLineNotFoundError,
  AlreadySignedOffError as BinCardAlreadySignedOffError,
  BinCardPhotoRequiredError,
} from "../application/reconciliation/captureBinCard";
import { BinCardNotYetCapturedError, LineAlreadyReviewedError } from "../application/reconciliation/reviewLine";
import {
  DailyReconciliationNotFoundError,
  NotAllLinesReviewedError,
  ReconciliationAlreadySignedOffError,
} from "../application/reconciliation/signOff";
import {
  SameBranchTransferError,
  InvalidTransferQuantityError,
  InterBranchTransferNotFoundError,
  InvalidInterBranchTransferStateError,
} from "../application/transfer/request";
import { SourceStorageLocationNotFoundError, WrongTransferApproverRoleError } from "../application/transfer/approveSending";
import { TransferCountSlipAlreadySubmittedError } from "../application/transfer/pick";
import { TransferCheckerMustNotBePickerError } from "../application/transfer/check";
import {
  TransferReceiveCountAlreadySubmittedError,
  TransferReceiveCountMissingError,
  TransferReceiveCheckerMustNotBeReceiverError,
} from "../application/transfer/receiveCount";
import { TransitEvidenceNotRequiredError, NoTransitEvidenceOnFileError } from "../application/transfer/confirmEvidence";
import {
  ReceiveCountRequiredError,
  TransitEvidenceConfirmationRequiredError,
  DestinationStorageLocationNotFoundError,
  MissingDispatchLedgerRowError,
} from "../application/transfer/close";
import { UnauthenticatedError } from "./currentActor";
import { InvalidRequestBodyError } from "./parseBody";
import { InvalidBusinessDateError } from "./businessDate";
import { UnknownReportIdError, UnsupportedExportFormatError } from "../application/reporting/export/registry";
import { DuplicateSkuError } from "../application/inventory/createProduct";

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
  [DamageReportRequiredForAdj03Error, 422, "DAMAGE_REPORT_REQUIRED"],
  [DamageReportNotYetDisposedError, 409, "DAMAGE_REPORT_NOT_YET_DISPOSED"],
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
  [DiscrepancyCaseNotFoundError, 404, "NOT_FOUND"],
  [InvalidDiscrepancyCaseStateError, 409, "INVALID_STATE"],
  [AssigneeRequiredError, 422, "ASSIGNEE_REQUIRED"],
  [CaseNotAssignedError, 422, "CASE_NOT_ASSIGNED"],
  [ResolutionRequiredError, 422, "RESOLUTION_REQUIRED"],
  [OriginalSaleLineNotFoundError, 404, "NOT_FOUND"],
  [OriginalSaleNotEligibleForReturnError, 422, "NOT_ELIGIBLE_FOR_RETURN"],
  [InvalidReturnQuantityError, 400, "INVALID_QUANTITY"],
  [ExceedsRemainingReturnableQtyError, 409, "EXCEEDS_REMAINING_RETURNABLE_QTY"],
  [WrongReturnApproverRoleError, 403, "WRONG_APPROVER_ROLE"],
  [ReturnAuthorizationNotFoundError, 404, "NOT_FOUND"],
  [InvalidReturnAuthorizationStateError, 409, "INVALID_STATE"],
  [ReturnAuthorizationExpiredError, 409, "RETURN_AUTHORIZATION_EXPIRED"],
  [ReturnCountAlreadySubmittedError, 409, "ALREADY_SUBMITTED"],
  [ReturnReceiveCountMissingError, 422, "RECEIVE_COUNT_MISSING"],
  [ReturnCheckerMustNotBeReceiverError, 403, "SOD_VIOLATION"],
  [GradingEvidenceRequiredError, 422, "GRADING_EVIDENCE_REQUIRED"],
  [GraderCannotBeIssuerError, 403, "SOD_VIOLATION"],
  [GraderMustDifferFromFirstGraderError, 403, "SOD_VIOLATION"],
  [GradingAlreadySubmittedError, 409, "ALREADY_SUBMITTED"],
  [BothReturnCountsRequiredError, 422, "BOTH_COUNTS_REQUIRED"],
  [GradingIncompleteError, 409, "GRADING_INCOMPLETE"],
  [ReturnNotDisputedError, 409, "NOT_DISPUTED"],
  [ReturnWarehouseLocationNotFoundError, 422, "WAREHOUSE_LOCATION_NOT_CONFIGURED"],
  [AlreadyPostedError, 409, "ALREADY_POSTED"],
  [NotReadyForReturnPostingError, 409, "NOT_READY_FOR_POSTING"],
  [ReturnMissingDocumentNumberError, 500, "INTERNAL_ERROR"],
  [CannotVoidReceivedReturnError, 409, "CANNOT_VOID_RECEIVED"],
  [CauseRequiredError, 422, "CAUSE_REQUIRED"],
  [InvalidDamageQuantityError, 400, "INVALID_QUANTITY"],
  [DamageReportNotFoundError, 404, "NOT_FOUND"],
  [InvalidDamageReportStateError, 409, "INVALID_STATE"],
  [ExceedsUndisposedQtyError, 409, "EXCEEDS_UNDISPOSED_QTY"],
  [WitnessMustNotBeWarehouseRoleError, 403, "WITNESS_MUST_NOT_BE_WAREHOUSE_ROLE"],
  [SameWitnessError, 400, "SAME_WITNESS"],
  [InvalidCertificateQuantityError, 400, "INVALID_QUANTITY"],
  [DisposalCertificateNotFoundError, 404, "NOT_FOUND"],
  [InvalidDisposalCertificateStateError, 409, "INVALID_STATE"],
  [WrongDispositionError, 409, "WRONG_DISPOSITION"],
  [DestructionEvidenceRequiredError, 422, "DESTRUCTION_EVIDENCE_REQUIRED"],
  [NotReadyForDisposalPostingError, 409, "NOT_READY_FOR_POSTING"],
  [ScrapSaleAlreadyRecordedError, 409, "ALREADY_RECORDED"],
  [ScrapSaleJustificationRequiredError, 422, "SCRAP_SALE_JUSTIFICATION_REQUIRED"],
  [ScrapBuyerBenchmarkNotFoundError, 404, "NOT_FOUND"],
  [ScrapSaleRecordNotFoundError, 404, "NOT_FOUND"],
  [ScrapSaleNotBelowBenchmarkError, 400, "NOT_BELOW_BENCHMARK"],
  [ScrapSaleAlreadyApprovedError, 409, "ALREADY_APPROVED"],
  [WrongScrapSaleApproverRoleError, 403, "WRONG_APPROVER_ROLE"],
  [ScrapSaleApprovalRequiredError, 422, "SCRAP_SALE_APPROVAL_REQUIRED"],
  [QuoteEvidenceRequiredError, 422, "QUOTE_EVIDENCE_REQUIRED"],
  [CannotVoidPostedDisposalCertificateError, 409, "CANNOT_VOID_POSTED"],
  [VoidReasonRequiredError, 422, "VOID_REASON_REQUIRED"],
  [NoBranchManagerConfiguredError, 422, "NO_BRANCH_MANAGER_CONFIGURED"],
  [VoidWithoutReturnReasonRequiredError, 422, "VOID_WITHOUT_RETURN_REASON_REQUIRED"],
  [CycleCountWindowAlreadyActiveError, 409, "CYCLE_COUNT_WINDOW_ALREADY_ACTIVE"],
  [CycleCountWindowNotFoundError, 404, "NOT_FOUND"],
  [CycleCountWindowNotActiveError, 409, "CYCLE_COUNT_WINDOW_NOT_ACTIVE"],
  [ExceptionReasonRequiredError, 422, "EXCEPTION_REASON_REQUIRED"],
  [BranchLockedForCycleCountError, 423, "BRANCH_LOCKED_FOR_CYCLE_COUNT"],
  [InvalidOrExpiredCycleCountWindowExceptionError, 422, "INVALID_OR_EXPIRED_EXCEPTION"],
  [NoOwnerConfiguredError, 422, "NO_OWNER_CONFIGURED"],
  [NoActiveCycleCountWindowError, 422, "NO_ACTIVE_CYCLE_COUNT_WINDOW"],
  [CycleCountRecordAlreadyOpenError, 409, "CYCLE_COUNT_RECORD_ALREADY_OPEN"],
  [CycleCountRecordNotFoundError, 404, "NOT_FOUND"],
  [InvalidCycleCountRecordStateError, 409, "INVALID_STATE"],
  [CycleCountSlipAlreadySubmittedError, 409, "ALREADY_SUBMITTED"],
  [PrimaryCountMissingError, 422, "PRIMARY_COUNT_MISSING"],
  [SecondaryCounterMustNotBePrimaryError, 403, "SOD_VIOLATION"],
  [CycleCountWitnessRequiredError, 422, "WITNESS_REQUIRED"],
  [CollectorMustNotBeCounterError, 403, "SOD_VIOLATION"],
  [BothCountsRequiredError, 422, "BOTH_COUNTS_REQUIRED"],
  [RecounterMustDifferFromPriorCountersError, 403, "SOD_VIOLATION"],
  [DailyReconciliationAlreadyPreparedError, 409, "ALREADY_PREPARED"],
  [DailyReconciliationLineNotFoundError, 404, "NOT_FOUND"],
  [BinCardAlreadySignedOffError, 409, "ALREADY_SIGNED_OFF"],
  [BinCardPhotoRequiredError, 422, "BIN_CARD_PHOTO_REQUIRED"],
  [BinCardNotYetCapturedError, 422, "BIN_CARD_NOT_YET_CAPTURED"],
  [LineAlreadyReviewedError, 409, "ALREADY_REVIEWED"],
  [DailyReconciliationNotFoundError, 404, "NOT_FOUND"],
  [NotAllLinesReviewedError, 422, "NOT_ALL_LINES_REVIEWED"],
  [ReconciliationAlreadySignedOffError, 409, "ALREADY_SIGNED_OFF"],
  [SameBranchTransferError, 400, "SAME_BRANCH_TRANSFER"],
  [InvalidTransferQuantityError, 400, "INVALID_QUANTITY"],
  [InterBranchTransferNotFoundError, 404, "NOT_FOUND"],
  [InvalidInterBranchTransferStateError, 409, "INVALID_STATE"],
  [SourceStorageLocationNotFoundError, 422, "WAREHOUSE_LOCATION_NOT_CONFIGURED"],
  [WrongTransferApproverRoleError, 403, "WRONG_APPROVER_ROLE"],
  [TransferCountSlipAlreadySubmittedError, 409, "ALREADY_SUBMITTED"],
  [TransferCheckerMustNotBePickerError, 403, "SOD_VIOLATION"],
  [TransferReceiveCountAlreadySubmittedError, 409, "ALREADY_SUBMITTED"],
  [TransferReceiveCountMissingError, 422, "RECEIVE_COUNT_MISSING"],
  [TransferReceiveCheckerMustNotBeReceiverError, 403, "SOD_VIOLATION"],
  [TransitEvidenceNotRequiredError, 400, "TRANSIT_EVIDENCE_NOT_REQUIRED"],
  [NoTransitEvidenceOnFileError, 422, "NO_TRANSIT_EVIDENCE_ON_FILE"],
  [ReceiveCountRequiredError, 422, "RECEIVE_COUNT_REQUIRED"],
  [TransitEvidenceConfirmationRequiredError, 422, "TRANSIT_EVIDENCE_CONFIRMATION_REQUIRED"],
  [DestinationStorageLocationNotFoundError, 422, "WAREHOUSE_LOCATION_NOT_CONFIGURED"],
  [MissingDispatchLedgerRowError, 409, "MISSING_DISPATCH_LEDGER_ROW"],
  [InvalidBusinessDateError, 400, "INVALID_BUSINESS_DATE"],
  [UnknownReportIdError, 404, "UNKNOWN_REPORT_ID"],
  [UnsupportedExportFormatError, 400, "UNSUPPORTED_EXPORT_FORMAT"],
  [DuplicateSkuError, 409, "DUPLICATE_SKU"],
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
