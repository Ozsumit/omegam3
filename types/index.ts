// /types/index.ts

export interface Message {
  id?: number;
  tempId?: string; // For optimistic UI updates
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  type: "text" | "file-transfer";
  status: "pending" | "sent" | "delivered" | "failed";
  fileInfo?: FileInfo;
  reactions?: { [key: string]: number };
}

export interface FileInfo {
  id: string; // The transfer ID
  name: string;
  size: number;
  type: string;
  hash?: string;
}

export interface FileTransfer {
  // Transfer Info
  id: string;
  name: string;
  size: number;
  type: string;
  hash?: string;

  // State
  status: "pending" | "transferring" | "completed" | "failed" | "receiving";
  progress: number;
  direction: "incoming" | "outgoing";

  // For incoming files
  dataChunks?: ArrayBuffer[];
}

// Stored file in IndexedDB
export interface StoredFile {
  id: string; // Corresponds to FileInfo.id
  blob: Blob;
}

export interface PeerData {
  id: string;
  name: string;
  status: "online" | "offline";
  unreadCount: number;
}

export interface UserProfile {
  id: string;
  name: string;
  preferences: {
    theme: "light" | "dark";
    autoDownload: boolean;
  };
}
