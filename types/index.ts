// /types/index.ts

export interface Message {
  id?: number;
  tempId?: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  type: "text" | "file-transfer";
  status: "pending" | "sent" | "delivered" | "failed";
  fileInfo?: FileInfo;
  reactions?: Record<string, string[]>;
}

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface FileTransfer {
  id: string;
  name: string;
  size: number;
  type: string;
  status:
    | "transferring"
    | "completed"
    | "failed"
    | "receiving"
    | "paused"
    | "cancelled"
    | "queued";
  progress: number;
  direction: "incoming" | "outgoing";
  speed?: number;
  timeRemaining?: number;
}

export interface StoredFile {
  id: string;
  blob: Blob;
}

export interface PeerData {
  id: string;
  name: string;
  status: "online" | "offline" | "connecting";
  unreadCount: number;
  lastSeen?: number;
  avatar?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  avatar?: string;
}

export interface FolderToSend {
  handle: FileSystemDirectoryHandle | FileList | File[];
  name: string;
  isFallback: boolean;
}

export type PeerMessagePayload =
  | { type: "profile-info"; payload: { id: string; name: string } }
  | { type: "text"; payload: { content: string } }
  | { type: "file-meta"; payload: FileInfo }
  | { type: "file-chunk"; payload: { id: string; chunk: ArrayBuffer; seq?: number } }
  | { type: "file-end"; payload: { id: string } }
  | { type: "typing"; payload: { isTyping: boolean } }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "ack"; payload: { id: string; seq: number } }
  | { type: "reaction"; payload: { messageId: number; reaction: string; userId: string } };

export interface ChatState {
  peers: Record<string, PeerData>;
  messages: Record<string, Message[]>;
  fileTransfers: Record<string, FileTransfer>;
  selectedConversationId: string | null;
  typingStates: Record<string, boolean>;
}

export type ChatAction =
  | { type: "INIT_STATE"; payload: { peers: PeerData[]; messages: Message[] } }
  | { type: "SELECT_CONVERSATION"; payload: string | null }
  | { type: "ADD_PEER"; payload: PeerData }
  | { type: "UPDATE_PEER_STATUS"; payload: { peerId: string; status: PeerData["status"] } }
  | { type: "ADD_MESSAGE"; payload: Message }
  | { type: "UPDATE_MESSAGE_STATUS"; payload: { tempId: string; newId: number; status: Message["status"]; conversationId: string } }
  | { type: "INCREMENT_UNREAD"; payload: string }
  | { type: "START_FILE_TRANSFER"; payload: FileTransfer }
  | { type: "UPDATE_FILE_PROGRESS"; payload: { id: string; progress: number } }
  | { type: "FINISH_FILE_TRANSFER"; payload: { id: string; status: FileTransfer["status"] } }
  | { type: "UPDATE_TYPING_STATUS"; payload: { peerId: string; isTyping: boolean } }
  | { type: "DELETE_PEER"; payload: string };
