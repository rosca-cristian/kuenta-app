/** How handing a file to the share menu ended: shared, downloaded instead, or the user closed the menu. */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** Device services screens may use. A Capacitor implementation could replace the web one. */
export interface PlatformServices {
  /** The file received through the system's share sheet, if any. Consumed once. */
  takeSharedFile(): Promise<File | null>;
  /** Asks the browser to keep the data even under storage pressure. */
  requestPersistence(): Promise<boolean>;
  isPersisted(): Promise<boolean>;
  /** Hands a file Kuenta made (a CSV export or a backup) to the user, as a download on the web. */
  saveFile(file: File): Promise<void>;
  /**
   * Opens the system's share menu with the file (Drive, email, Telegram…). Where files can't
   * be shared, it downloads it as `saveFile` does. `cancelled` when the user closed the menu.
   */
  shareFile(file: File): Promise<ShareOutcome>;
}
