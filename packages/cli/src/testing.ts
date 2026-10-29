import { onTestFinished } from 'vitest';
import { checkDocument, documentsIn, INTERNAL_SCHEMAS } from './contract';

/**
 * Checks every --json document in what a command printed against the contract, strictly
 * (spec §11, Slice 10c): but for the helpers' answers to Mediaplane itself. A human's
 * output holds none.
 */
export function checkPrinted(stdout: string): void {
  for (const doc of documentsIn(stdout)) {
    const { schema } = doc as { schema?: string };
    if (!INTERNAL_SCHEMAS.includes(schema ?? '')) checkDocument(doc);
  }
}

/**
 * checkPrinted() of what `stdout` gives once the test that calls this finishes, which
 * fails if a document doesn't match. Call it while a test runs, never from a hook.
 */
export function checkWhenFinished(stdout: () => string): void {
  onTestFinished(() => {
    checkPrinted(stdout());
  });
}
