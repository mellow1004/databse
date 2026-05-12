/**
 * Shared types for the intake pipeline (Phase 2): CSV parsing → staging → promotion.
 * The parser produces ParsedCsvRow objects; the intake service later writes them as
 * StagingRecord rows once tombstone / required-field checks have run.
 */

export type ParsedCsvRow = {
  /** 1-indexed line number; header is row 1, first data row is row 2 */
  rowNumber: number;
  /** Original CSV column → value, untouched. Preserved for provenance. */
  rawValues: Record<string, string>;
  /** Normalised candidate values, mapped from header aliases. */
  candidate: {
    email: string | null;
    linkedinUrl: string | null;
    phone: string | null;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    companyName: string | null;
    domain: string | null;
    country: string | null;
  };
  /** Empty array = valid row. */
  validationErrors: string[];
};

export type ParseResult = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: ParsedCsvRow[];
  /** Errors that apply to the whole file, e.g. unparseable CSV, no data rows. */
  fileLevelErrors: string[];
};
