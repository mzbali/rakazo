import type { ReactElement } from "react";

export type JobSwipeRowProps = {
  rowKey: string;
  /** Finished jobs can be swiped away; the rest stay put. */
  clearable: boolean;
  onClear: () => void;
  children: ReactElement;
};

/** Swipe to clear is iOS list behaviour; elsewhere the job's sheet has a Clear button. */
export function JobSwipeRow({ children }: JobSwipeRowProps) {
  return children;
}
