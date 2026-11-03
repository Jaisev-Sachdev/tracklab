/** A value with its standard error (one sigma). */
export type Measured = { value: number; se: number };

/** Length scale of the video. */
export type Calibration = { pxPerM: number; pxPerMSe: number };
