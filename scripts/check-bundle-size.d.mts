export type BrowserAsset = { file: string; bytes: number; gzip_bytes: number };
export type BundleReport = {
  assets: BrowserAsset[];
  total_gzip_bytes: number;
  budget_bytes: number;
  gzip_options: Readonly<{ level: number }>;
  node: string;
  zlib: string;
  passed: boolean;
};
export function bundleReport(assets: BrowserAsset[]): BundleReport;
export function measureBrowserBundle(directory?: string): Promise<BundleReport>;
