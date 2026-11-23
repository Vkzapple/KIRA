export type Detection = {
  box: [number, number, number, number];
  class: string;
  confidence: number;
  detected: string;
  recommendation: string;
};

export type PredictResult = {
  width?: number;
  height?: number;
  count: number;
  reportedCount?: number;
  results: Detection[];
};
