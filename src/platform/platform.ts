/** Device services screens may use. A Capacitor implementation could replace the web one. */
export interface PlatformServices {
  /** The file received through the system's share sheet, if any. Consumed once. */
  takeSharedFile(): Promise<File | null>;
  /** Asks the browser to keep the data even under storage pressure. */
  requestPersistence(): Promise<boolean>;
  isPersisted(): Promise<boolean>;
  /** Hands a file Kuenta made (a CSV export) to the user, as a download on the web. */
  saveFile(file: File): Promise<void>;
}
