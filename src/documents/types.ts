export type DocKind = 'pdf' | 'docx' | 'txt' | 'md' | 'csv' | 'xlsx' | 'json';

/** One citable part of a file: a PDF page, a document section, a sheet, or a block of lines. */
export interface DocUnit {
  /** 1-based number used in citations ("page 3"). */
  n: number;
  /** Human label, for example `page 3`, `section "Termination"`, `sheet "Sales"`, `lines 1-60`. */
  label: string;
  text: string;
}

export interface ReadDocument {
  /** Name shown to the user and used in citations. */
  name: string;
  kind: DocKind;
  bytes: number;
  /** Hash of the original file. */
  sha256: string;
  units: DocUnit[];
}

export const EXTENSIONS: Readonly<Record<string, DocKind>> = {
  '.pdf': 'pdf', '.docx': 'docx', '.txt': 'txt', '.text': 'txt', '.md': 'md', '.markdown': 'md',
  '.csv': 'csv', '.xlsx': 'xlsx', '.json': 'json',
};

export class DocumentError extends Error {
  constructor(message: string, readonly code: 'unsupported' | 'too_large' | 'unreadable' | 'empty') {
    super(message);
    this.name = 'DocumentError';
  }
}

export const LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPdfPages: 1000,
  /** Cap on extracted text per file, so a small zip cannot expand into something huge. */
  maxTextChars: 20_000_000,
  linesPerUnit: 60,
  csvRowsPerUnit: 200,
  xlsxRowsPerUnit: 200,
  docxCharsPerPart: 4000,
} as const;
