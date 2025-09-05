"use client";

import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import Peer, { DataConnection } from "peerjs";
import Dexie from "dexie";
import JSZip from "jszip";
// import Image from "next/image"; // Removed as it was declared but never read.
// --- UI Imports ---
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/toaster";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- Icon Imports (Added ArrowLeft) ---
import {
  Loader2,
  Send,
  UserPlus,
  Download,
  Copy,
  Paperclip,
  XCircle,
  CheckCircle,
  Hourglass,
  FileText,
  Images,
  Video,
  Music,
  Archive,
  RefreshCw,
  Zap,
  ArrowLeft, // Added for mobile back button
  MoreVertical,
  Trash2,
  Clipboard,
  MessageSquare,
} from "lucide-react";

// --- Interfaces & Types ---

interface Message {
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
}

interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
}

interface FileTransfer {
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

interface StoredFile {
  id: string;
  blob: Blob;
}

interface PeerData {
  id: string;
  name: string;
  status: "online" | "offline" | "connecting";
  unreadCount: number;
  lastSeen?: number;
  avatar?: string;
}

interface UserProfile {
  id: string;
  name: string;
  avatar?: string;
}

interface FolderToSend {
  handle: FileSystemDirectoryHandle | FileList | File[]; // Broaden type for dropped folder contents
  name: string;
  isFallback: boolean; // True if handle is FileList/File[] (from webkitdirectory or D&D fallback)
}

// --- State & Action Types for Reducer ---
type ChatState = {
  peers: Record<string, PeerData>;
  messages: Record<string, Message[]>;
  fileTransfers: Record<string, FileTransfer>;
  selectedConversationId: string | null;
  typingStates: Record<string, boolean>; // ADDED: Typing indicator state
};

type ChatAction =
  | { type: "INIT_STATE"; payload: { peers: PeerData[]; messages: Message[] } }
  | { type: "SELECT_CONVERSATION"; payload: string | null }
  | { type: "ADD_PEER"; payload: PeerData }
  | {
      type: "UPDATE_PEER_STATUS";
      payload: { peerId: string; status: PeerData["status"] };
    }
  | { type: "ADD_MESSAGE"; payload: Message }
  | { type: "CLEAR_CONVERSATION_MESSAGES"; payload: string } // ADDED
  | { type: "DELETE_PEER"; payload: string } // ADDED
  | {
      type: "UPDATE_MESSAGE_STATUS";
      payload: {
        tempId: string;
        newId: number;
        status: Message["status"];
        conversationId: string;
      };
    }
  | { type: "INCREMENT_UNREAD"; payload: string }
  | { type: "START_FILE_TRANSFER"; payload: FileTransfer }
  | { type: "UPDATE_FILE_PROGRESS"; payload: { id: string; progress: number } }
  | {
      type: "FINISH_FILE_TRANSFER";
      payload: { id: string; status: FileTransfer["status"] };
    }
  | {
      type: "UPDATE_TYPING_STATUS";
      payload: { peerId: string; isTyping: boolean };
    }; // ADDED

// --- P2P Data Payload Type ---
type PeerMessagePayload =
  | { type: "profile-info"; payload: { id: string; name: string } }
  | { type: "text"; payload: { content: string } }
  | { type: "file-meta"; payload: FileInfo }
  | { type: "file-chunk"; payload: { id: string; chunk: ArrayBuffer } }
  | { type: "file-end"; payload: { id: string } }
  | { type: "typing"; payload: { isTyping: boolean } }; // ADDED

const CHUNK_SIZE = 256 * 1024;

// --- Dexie DB Class ---
class MessagingDB extends Dexie {
  messages!: Dexie.Table<Message, number>;
  peers!: Dexie.Table<PeerData, string>;
  profile!: Dexie.Table<UserProfile, string>;
  files!: Dexie.Table<StoredFile, string>;

  constructor() {
    super("P2P_Chat_DB_v4");
    this.version(1).stores({
      messages: "++id, tempId, conversationId, timestamp",
      peers: "id, name",
      profile: "id",
      files: "id",
    });
  }
}

const db = new MessagingDB();

// --- Utility Functions ---
const generateNumericId = (): string =>
  Math.floor(1000 + Math.random() * 9000).toString();

const getOrGenerateUserId = (): string => {
  const storedUserId = localStorage.getItem("userId");
  if (storedUserId) return storedUserId;
  const newUserId = generateNumericId();
  localStorage.setItem("userId", newUserId);
  return newUserId;
};

const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

const getFileIcon = (type: string) => {
  if (type.startsWith("image/")) return <Images className="h-4 w-4" />;
  if (type.startsWith("video/")) return <Video className="h-4 w-4" />;
  if (type.startsWith("audio/")) return <Music className="h-4 w-4" />;
  if (type.includes("zip") || type.includes("rar") || type.includes("7z"))
    return <Archive className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
};

const titleCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

// Helper function to recursively get files from a FileSystemDirectoryEntry (for D&D webkitGetAsEntry)
async function getFilesFromDirectoryEntry(
  directoryEntry: FileSystemDirectoryEntry
): Promise<File[]> {
  const files: File[] = [];
  const reader = directoryEntry.createReader();

  const readEntries = async (entries: FileSystemEntry[]) => {
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve) =>
          (entry as FileSystemFileEntry).file(resolve)
        );
        // Add webkitRelativePath for consistent handling
        Object.defineProperty(file, "webkitRelativePath", {
          writable: true,
          value:
            directoryEntry.fullPath === "/"
              ? entry.name
              : `${directoryEntry.fullPath.substring(1)}/${entry.name}`,
        });
        files.push(file);
      } else if (entry.isDirectory) {
        files.push(
          ...(await getFilesFromDirectoryEntry(
            entry as FileSystemDirectoryEntry
          ))
        );
      }
    }
  };

  let allEntries: FileSystemEntry[] = [];
  let currentEntries;
  do {
    currentEntries = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve)
    );
    allEntries = allEntries.concat(currentEntries);
  } while (currentEntries.length > 0);

  await readEntries(allEntries);
  return files;
}

// Function to truncate long file names for toast (ADDED)
const truncateFileName = (fileName: string, maxLength: number = 30) => {
  if (fileName.length <= maxLength) {
    return fileName;
  }
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex === -1 || fileName.length - extensionIndex > 5) {
    // No extension or very long extension
    return fileName.substring(0, maxLength - 3) + "...";
  }
  const namePart = fileName.substring(0, extensionIndex);
  const extensionPart = fileName.substring(extensionIndex);
  const availableLength = maxLength - extensionPart.length - 3; // 3 for "..."
  if (availableLength <= 0) {
    // If extension itself is too long
    return fileName.substring(0, maxLength - 3) + "...";
  }
  return namePart.substring(0, availableLength) + "..." + extensionPart;
};

// --- Hooks ---

function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const loadProfile = async () => {
      setIsLoading(true);
      const userId = localStorage.getItem("userId");
      if (userId) {
        const userProfile = await db.profile.get(userId);
        if (userProfile) {
          setProfile(userProfile);
          setIsLoading(false);
          return;
        }
      }
      setIsLoading(false);
    };
    loadProfile();
  }, []);

  const createUserProfile = async (name: string): Promise<UserProfile> => {
    if (!name.trim()) throw new Error("Display name cannot be empty.");
    const userId = getOrGenerateUserId();
    const newProfile: UserProfile = { id: userId, name };
    await db.profile.put(newProfile);
    setProfile(newProfile);
    return newProfile;
  };

  return { profile, isLoading, createUserProfile };
}

function useNotifications() {
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const unreadCountRef = useRef(0);
  const originalTitleRef = useRef(document.title);
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null); // ADDED: Sound element ref

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
    // ADDED: Initialize sound
    if (typeof Audio !== "undefined") {
      // Ensure you have a 'notification.mp3' file in your public/sounds directory
      notificationSoundRef.current = new Audio("/sounds/notification.mp3");
      notificationSoundRef.current.load();
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && unreadCountRef.current > 0) {
        unreadCountRef.current = 0;
        document.title = originalTitleRef.current;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const requestPermission = useCallback(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then(setPermission);
    }
  }, []);

  const showNotification = useCallback(
    (title: string, options: NotificationOptions) => {
      if (document.hidden && permission === "granted") {
        const notification = new Notification(title, {
          ...options,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
        });
        notification.onclick = () => window.focus();
      }
    },
    [permission]
  );

  // ADDED: Play sound
  const playSoundNotification = useCallback(() => {
    if (notificationSoundRef.current) {
      // Clone the node to allow multiple rapid plays
      const sound =
        notificationSoundRef.current.cloneNode() as HTMLAudioElement;
      sound
        .play()
        .catch((error) =>
          console.warn("Failed to play notification sound:", error)
        );
    }
  }, []);

  // ADDED: Update tab title
  const updateTabTitle = useCallback((peerName: string | null) => {
    if (document.hidden) {
      unreadCountRef.current += 1;
      if (peerName) {
        document.title = `(${unreadCountRef.current}) Message from ${peerName}`;
      } else {
        document.title = `(${unreadCountRef.current}) New Messages`;
      }
    } else {
      unreadCountRef.current = 0;
      document.title = originalTitleRef.current;
    }
  }, []);

  return {
    requestPermission,
    showNotification,
    playSoundNotification,
    updateTabTitle,
  }; // ADDED
}

// --- Reducer with Strict Typing ---
const chatReducer = (state: ChatState, action: ChatAction): ChatState => {
  const { type, payload } = action;

  switch (type) {
    case "INIT_STATE": {
      const messagesByConv = payload.messages.reduce(
        (acc: Record<string, Message[]>, msg) => {
          if (!acc[msg.conversationId]) acc[msg.conversationId] = [];
          acc[msg.conversationId].push(msg);
          return acc;
        },
        {}
      );
      const peersById = payload.peers.reduce(
        (acc: Record<string, PeerData>, peer) => {
          acc[peer.id] = peer;
          return acc;
        },
        {}
      );
      return {
        ...state,
        peers: peersById,
        messages: messagesByConv,
        typingStates: {},
      }; // ADDED typingStates
    }
    case "SELECT_CONVERSATION": {
      if (payload && state.peers[payload]) {
        return {
          ...state,
          selectedConversationId: payload,
          peers: {
            ...state.peers,
            [payload]: { ...state.peers[payload], unreadCount: 0 },
          },
        };
      }
      return { ...state, selectedConversationId: payload };
    }
    case "ADD_PEER":
      return {
        ...state,
        peers: { ...state.peers, [payload.id]: payload },
      };
    case "DELETE_PEER": // ADDED
      const newPeers = { ...state.peers };
      delete newPeers[payload];
      const newMessagesAfterDelete = { ...state.messages };
      delete newMessagesAfterDelete[payload];
      const newFileTransfersAfterDelete = { ...state.fileTransfers };
      // Filter out file transfers related to the deleted peer
      Object.keys(newFileTransfersAfterDelete).forEach((fileId) => {
        if (
          state.messages[payload]?.some((msg) => msg.fileInfo?.id === fileId)
        ) {
          delete newFileTransfersAfterDelete[fileId];
        }
      });

      return {
        ...state,
        peers: newPeers,
        messages: newMessagesAfterDelete,
        fileTransfers: newFileTransfersAfterDelete,
        selectedConversationId:
          state.selectedConversationId === payload
            ? null
            : state.selectedConversationId,
      };
    case "UPDATE_PEER_STATUS": {
      if (!state.peers[payload.peerId]) return state;
      return {
        ...state,
        peers: {
          ...state.peers,
          [payload.peerId]: {
            ...state.peers[payload.peerId],
            status: payload.status,
            lastSeen:
              payload.status === "offline"
                ? Date.now()
                : state.peers[payload.peerId].lastSeen,
          },
        },
      };
    }
    case "ADD_MESSAGE": {
      const { conversationId } = payload;
      const newMessages = [...(state.messages[conversationId] ?? []), payload];
      return {
        ...state,
        messages: { ...state.messages, [conversationId]: newMessages },
      };
    }
    case "CLEAR_CONVERSATION_MESSAGES": // ADDED
      const clearedMessages = { ...state.messages };
      delete clearedMessages[payload];
      const clearedFileTransfers = { ...state.fileTransfers };
      // Filter out file transfers related to the cleared conversation
      Object.keys(clearedFileTransfers).forEach((fileId) => {
        if (
          state.messages[payload]?.some((msg) => msg.fileInfo?.id === fileId)
        ) {
          delete clearedFileTransfers[fileId];
        }
      });
      return {
        ...state,
        messages: clearedMessages,
        fileTransfers: clearedFileTransfers,
      };
    case "UPDATE_MESSAGE_STATUS": {
      const { tempId, newId, status, conversationId } = payload;
      if (!state.messages[conversationId]) return state;

      const updatedConvMessages = state.messages[conversationId].map((m) =>
        m.tempId === tempId ? { ...m, status, id: newId, tempId: undefined } : m
      );

      return {
        ...state,
        messages: { ...state.messages, [conversationId]: updatedConvMessages },
      };
    }
    case "INCREMENT_UNREAD": {
      if (!state.peers[payload] || state.selectedConversationId === payload)
        return state;
      const currentUnread = state.peers[payload].unreadCount ?? 0;
      return {
        ...state,
        peers: {
          ...state.peers,
          [payload]: {
            ...state.peers[payload],
            unreadCount: currentUnread + 1,
          },
        },
      };
    }
    case "START_FILE_TRANSFER":
      return {
        ...state,
        fileTransfers: { ...state.fileTransfers, [payload.id]: payload },
      };
    case "UPDATE_FILE_PROGRESS": {
      if (!state.fileTransfers[payload.id]) return state;
      return {
        ...state,
        fileTransfers: {
          ...state.fileTransfers,
          [payload.id]: {
            ...state.fileTransfers[payload.id],
            progress: payload.progress,
          },
        },
      };
    }
    case "FINISH_FILE_TRANSFER": {
      if (!state.fileTransfers[payload.id]) return state;
      return {
        ...state,
        fileTransfers: {
          ...state.fileTransfers,
          [payload.id]: {
            ...state.fileTransfers[payload.id],
            status: payload.status,
            progress:
              payload.status === "completed"
                ? 100
                : state.fileTransfers[payload.id].progress,
          },
        },
      };
    }
    case "UPDATE_TYPING_STATUS": // ADDED
      return {
        ...state,
        typingStates: {
          ...state.typingStates,
          [payload.peerId]: payload.isTyping,
        },
      };
    default:
      return state;
  }
};

// --- usePeer Hook with correct PeerJS types ---
function usePeer({
  profile,
  onDataReceived,
  onPeerConnected,
  onPeerDisconnected,
}: {
  profile: UserProfile | null;
  onDataReceived: (peerId: string, data: PeerMessagePayload) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string, error?: boolean) => void;
}) {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [isPeerReady, setIsPeerReady] = useState<boolean>(false);
  const connectionsRef = useRef<Record<string, DataConnection>>({});
  const { toast } = useToast();

  useEffect(() => {
    if (!profile || peer) return;

    const newPeer = new Peer(profile.id);
    setPeer(newPeer);

    newPeer.on("open", (id) => {
      console.log("My peer ID is: " + id);
      setIsPeerReady(true);
    });

    newPeer.on("connection", (conn) => setupConnection(conn));

    newPeer.on("error", (err) => {
      console.error("PeerJS global error:", err);
      if (err.type === "peer-unavailable") {
        toast({
          title: "Peer not found",
          description:
            "The peer ID you are trying to connect to does not exist.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Connection Error",
          description: err.message,
          variant: "destructive",
        });
      }
    });

    return () => {
      newPeer.destroy();
    };
  }, [profile]);

  const setupConnection = useCallback(
    (conn: DataConnection) => {
      conn.on("open", () => {
        console.log(`Connection established with ${conn.peer}`);
        connectionsRef.current[conn.peer] = conn;
        onPeerConnected(conn.peer);
        if (profile) {
          conn.send({
            type: "profile-info",
            payload: { id: profile.id, name: profile.name },
          });
        }
      });

      conn.on("data", (data: unknown) =>
        onDataReceived(conn.peer, data as PeerMessagePayload)
      );

      const handleClose = () => {
        console.log(`Connection closed with ${conn.peer}`);
        delete connectionsRef.current[conn.peer];
        onPeerDisconnected(conn.peer);
      };

      conn.on("close", handleClose);
      conn.on("error", (err) => {
        console.error(`Connection error with ${conn.peer}:`, err);
        delete connectionsRef.current[conn.peer];
        onPeerDisconnected(conn.peer, true);
      });
    },
    [profile, onDataReceived, onPeerConnected, onPeerDisconnected]
  );

  const connectToPeer = useCallback(
    (remotePeerId: string) => {
      if (!peer || !isPeerReady || !remotePeerId) {
        console.warn("Peer not ready or no remotePeerId provided.");
        onPeerDisconnected(remotePeerId, true);
        return;
      }
      if (connectionsRef.current[remotePeerId]?.open) {
        console.log(`Connection to ${remotePeerId} is already open.`);
        return;
      }
      console.log(`Attempting to connect to ${remotePeerId}`);
      const conn = peer.connect(remotePeerId, { reliable: true });
      setupConnection(conn);
    },
    [peer, isPeerReady, setupConnection, onPeerDisconnected]
  );

  const reconnectToPastPeers = useCallback(async () => {
    if (!profile) return;
    const pastPeers = await db.peers.toArray();
    pastPeers.forEach((peerData) => {
      if (peerData.id !== profile.id) {
        connectToPeer(peerData.id);
      }
    });
  }, [connectToPeer, profile]);

  const sendMessageToPeer = useCallback(
    (peerId: string, data: PeerMessagePayload): boolean => {
      const conn = connectionsRef.current[peerId];
      if (conn?.open) {
        conn.send(data);
        return true;
      }
      console.warn(`Could not send message to ${peerId}: connection not open.`);
      return false;
    },
    []
  );

  return {
    peerId: profile?.id,
    isPeerReady,
    connectToPeer,
    reconnectToPastPeers,
    sendMessageToPeer,
  };
}

// --- Main Chat Logic Hook ---
function useChatManager(profile: UserProfile | null) {
  const initialState: ChatState = {
    peers: {},
    messages: {},
    fileTransfers: {},
    selectedConversationId: null,
    typingStates: {}, // ADDED
  };
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const { toast } = useToast();
  const {
    requestPermission,
    showNotification,
    playSoundNotification,
    updateTabTitle,
  } = useNotifications(); // ADDED
  const incomingFileBuffers = useRef<
    Record<string, { metadata: FileInfo; chunks: ArrayBuffer[] }>
  >({});

  const handleDataReceived = useCallback(
    async (peerId: string, data: PeerMessagePayload) => {
      if (!profile) return;
      const peerName = state.peers[peerId]?.name ?? peerId;

      switch (data.type) {
        case "profile-info": {
          const peerProfile = data.payload;
          const existingPeer = await db.peers.get(peerProfile.id);
          const peerUpdateData: PeerData = {
            id: peerProfile.id,
            name: peerProfile.name,
            status: "online",
            unreadCount: existingPeer?.unreadCount ?? 0,
          };

          await db.peers.put(peerUpdateData);
          dispatch({ type: "ADD_PEER", payload: peerUpdateData });
          break;
        }
        case "text": {
          const newTextMsg: Message = {
            conversationId: peerId,
            senderId: peerId,
            senderName: peerName,
            content: data.payload.content,
            timestamp: Date.now(),
            type: "text",
            status: "delivered",
          };
          await db.messages.add(newTextMsg);
          dispatch({ type: "ADD_MESSAGE", payload: newTextMsg });
          dispatch({ type: "INCREMENT_UNREAD", payload: peerId });
          // ADDED: Notifications
          showNotification(`New message from ${peerName}`, {
            body: data.payload.content,
          });
          playSoundNotification();
          updateTabTitle(peerName);
          break;
        }
        case "file-meta": {
          const metadata: FileInfo = data.payload;
          incomingFileBuffers.current[metadata.id] = { metadata, chunks: [] };
          dispatch({
            type: "START_FILE_TRANSFER",
            payload: {
              ...metadata,
              status: "receiving",
              progress: 0,
              direction: "incoming",
            },
          });
          const newFileMsg: Message = {
            conversationId: peerId,
            senderId: peerId,
            senderName: peerName,
            content: `Receiving file: ${metadata.name}`,
            timestamp: Date.now(),
            type: "file-transfer",
            status: "delivered",
            fileInfo: metadata,
          };
          const newId = await db.messages.add(newFileMsg);
          dispatch({
            type: "ADD_MESSAGE",
            payload: { ...newFileMsg, id: newId },
          });
          dispatch({ type: "INCREMENT_UNREAD", payload: peerId });
          // ADDED: Notifications
          showNotification(`Incoming file from ${peerName}`, {
            body: `${metadata.name} (${formatBytes(metadata.size)})`,
          });
          playSoundNotification();
          updateTabTitle(peerName);
          break;
        }
        case "file-chunk": {
          const { id, chunk } = data.payload;
          const transfer = incomingFileBuffers.current[id];
          if (transfer) {
            transfer.chunks.push(chunk);
            const receivedSize = transfer.chunks.reduce(
              (acc, c) => acc + c.byteLength,
              0
            );
            const progress = (receivedSize / transfer.metadata.size) * 100;
            dispatch({
              type: "UPDATE_FILE_PROGRESS",
              payload: { id, progress },
            });
          }
          break;
        }
        case "file-end": {
          const { id } = data.payload;
          const transfer = incomingFileBuffers.current[id];
          if (transfer) {
            const fileBlob = new Blob(transfer.chunks, {
              type: transfer.metadata.type,
            });
            if (fileBlob.size !== transfer.metadata.size) {
              console.error(
                `File corrupted: size mismatch for ${transfer.metadata.name}`
              );
              dispatch({
                type: "FINISH_FILE_TRANSFER",
                payload: { id, status: "failed" },
              });
              toast({
                title: "File Transfer Failed",
                description: `${transfer.metadata.name} was corrupted.`,
                variant: "destructive",
              });
            } else {
              await db.files.put({ id: id, blob: fileBlob });
              dispatch({
                type: "FINISH_FILE_TRANSFER",
                payload: { id, status: "completed" },
              });
              toast({
                title: "File Received",
                description: `${transfer.metadata.name} has been downloaded.`,
              });
            }
            delete incomingFileBuffers.current[id];
          }
          break;
        }
        case "typing": {
          // ADDED: Typing status handling
          dispatch({
            type: "UPDATE_TYPING_STATUS",
            payload: { peerId, isTyping: data.payload.isTyping },
          });
          break;
        }
      }
    },
    [
      profile,
      state.peers,
      toast,
      showNotification,
      playSoundNotification,
      updateTabTitle,
    ] // ADDED notification hooks
  );

  const handlePeerConnected = useCallback(
    async (peerId: string) => {
      await db.peers.update(peerId, { status: "online" });
      dispatch({
        type: "UPDATE_PEER_STATUS",
        payload: { peerId, status: "online" },
      });
      const peerName = state.peers[peerId]?.name ?? peerId;
      toast({
        title: "Peer Connected",
        description: `You are now connected to ${peerName}.`,
      });
      requestPermission();
    },
    [state.peers, toast, requestPermission]
  );

  const handlePeerDisconnected = useCallback(
    async (peerId: string, hadError?: boolean) => {
      // Don't do anything if we don't know about this peer
      if (!state.peers[peerId]) return;

      await db.peers.update(peerId, {
        status: "offline",
        lastSeen: Date.now(),
      });
      dispatch({
        type: "UPDATE_PEER_STATUS",
        payload: { peerId, status: "offline" },
      });
      dispatch({
        // ADDED: Clear typing status on disconnect
        type: "UPDATE_TYPING_STATUS",
        payload: { peerId, isTyping: false },
      });
      const peerName = state.peers[peerId]?.name ?? peerId;
      if (hadError) {
        toast({
          title: "Connection Failed",
          description: `Could not connect to ${peerName}. Peer may be offline or unreachable.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Peer Disconnected",
          description: `Connection lost with ${peerName}.`,
          variant: "destructive",
        });
      }
    },
    [state.peers, toast]
  );

  const peerHook = usePeer({
    profile,
    onDataReceived: handleDataReceived,
    onPeerConnected: handlePeerConnected,
    onPeerDisconnected: handlePeerDisconnected,
  });

  useEffect(() => {
    const loadInitialData = async () => {
      const [peers, messages] = await Promise.all([
        db.peers.toArray(),
        db.messages.toArray(),
      ]);
      peers.forEach((p: PeerData) => (p.status = "offline"));
      dispatch({ type: "INIT_STATE", payload: { peers, messages } });
    };
    loadInitialData();
  }, []);

  useEffect(() => {
    if (peerHook.isPeerReady) {
      peerHook.reconnectToPastPeers();
    }
  }, [peerHook.isPeerReady, peerHook.reconnectToPastPeers]);

  const connectToPeer = useCallback(
    (peerId: string) => {
      if (!peerId) return;
      const peerData = state.peers[peerId];
      if (peerData?.status === "online") {
        toast({
          title: "Already Connected",
          description: `You are already connected to ${peerData.name}.`,
        });
        return;
      }
      if (peerData?.status === "connecting") {
        toast({
          title: "Connection in Progress",
          description: `Already attempting to connect to ${peerData.name}.`,
        });
        return;
      }
      dispatch({
        type: "UPDATE_PEER_STATUS",
        payload: { peerId, status: "connecting" },
      });
      peerHook.connectToPeer(peerId);
    },
    [state.peers, peerHook.connectToPeer, toast]
  );

  const addAndConnectToPeer = async (peerId: string) => {
    if (!profile || !peerId || peerId === profile.id) return;
    const existingPeer = await db.peers.get(peerId);
    if (existingPeer) {
      connectToPeer(peerId);
    } else {
      const newPeer: PeerData = {
        id: peerId,
        name: `Peer ${peerId}`,
        status: "connecting",
        unreadCount: 0,
      };
      await db.peers.put(newPeer);
      dispatch({ type: "ADD_PEER", payload: newPeer });
      connectToPeer(peerId);
    }
  };

  const selectConversation = (peerId: string | null) => {
    dispatch({ type: "SELECT_CONVERSATION", payload: peerId });
    if (peerId) {
      // ADDED: Clear tab title when selecting a conversation
      updateTabTitle(null);
    }
  };

  const sendTypingStatus = useCallback(
    (isTyping: boolean) => {
      if (!profile || !state.selectedConversationId) return;
      peerHook.sendMessageToPeer(state.selectedConversationId, {
        type: "typing",
        payload: { isTyping },
      });
    },
    [profile, state.selectedConversationId, peerHook]
  );

  const sendMessage = async (content: string) => {
    if (!profile || !state.selectedConversationId || !content.trim()) return;
    const tempId = crypto.randomUUID();
    const convId = state.selectedConversationId;
    const message: Message = {
      tempId,
      conversationId: convId,
      senderId: profile.id,
      senderName: profile.name,
      content,
      timestamp: Date.now(),
      type: "text",
      status: "pending",
    };
    dispatch({ type: "ADD_MESSAGE", payload: message });

    // ADDED: Stop typing when message is sent
    sendTypingStatus(false);

    const success = peerHook.sendMessageToPeer(convId, {
      type: "text",
      payload: { content },
    });

    const newStatus = success ? "sent" : "failed";
    const { tempId: _t, ...dbMessage } = message;
    const newId = await db.messages.add({ ...dbMessage, status: newStatus });

    dispatch({
      type: "UPDATE_MESSAGE_STATUS",
      payload: { tempId, newId, status: newStatus, conversationId: convId },
    });

    if (!success)
      toast({
        title: "Message Failed",
        description: "Could not send message. Peer may be disconnected.",
        variant: "destructive",
      });
  };

  const sendFile = async (file: File) => {
    if (!profile || !state.selectedConversationId) return;
    const fileId = crypto.randomUUID();
    const peerId = state.selectedConversationId;
    const fileInfo: FileInfo = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type,
    };
    dispatch({
      type: "START_FILE_TRANSFER",
      payload: {
        ...fileInfo,
        status: "transferring",
        progress: 0,
        direction: "outgoing",
      },
    });

    const message: Message = {
      conversationId: peerId,
      senderId: profile.id,
      senderName: profile.name,
      content: `Sending file: ${file.name}`,
      timestamp: Date.now(),
      type: "file-transfer",
      status: "pending",
      fileInfo: fileInfo,
    };
    const newId = await db.messages.add(message);
    dispatch({ type: "ADD_MESSAGE", payload: { ...message, id: newId } });

    const metaSent = peerHook.sendMessageToPeer(peerId, {
      type: "file-meta",
      payload: fileInfo,
    });
    if (!metaSent) {
      toast({
        title: "File Transfer Failed",
        description: "Could not connect to peer.",
        variant: "destructive",
      });
      dispatch({
        type: "FINISH_FILE_TRANSFER",
        payload: { id: fileId, status: "failed" },
      });
      return;
    }
    let offset = 0;
    const reader = new FileReader();

    const readNextChunk = () => {
      if (offset >= file.size) {
        peerHook.sendMessageToPeer(peerId, {
          type: "file-end",
          payload: { id: fileId },
        });
        dispatch({
          type: "FINISH_FILE_TRANSFER",
          payload: { id: fileId, status: "completed" },
        });
        return;
      }
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      if (!e.target?.result) return;
      const chunk = e.target.result as ArrayBuffer;
      const chunkSent = peerHook.sendMessageToPeer(peerId, {
        type: "file-chunk",
        payload: { id: fileId, chunk },
      });
      if (!chunkSent) {
        dispatch({
          type: "FINISH_FILE_TRANSFER",
          payload: { id: fileId, status: "failed" },
        });
        toast({
          title: "Transfer Failed",
          description: "Connection lost during transfer.",
          variant: "destructive",
        });
        return;
      }
      offset += chunk.byteLength;
      const progress = (offset / file.size) * 100;
      dispatch({
        type: "UPDATE_FILE_PROGRESS",
        payload: { id: fileId, progress },
      });
      readNextChunk();
    };

    reader.onerror = () => {
      dispatch({
        type: "FINISH_FILE_TRANSFER",
        payload: { id: fileId, status: "failed" },
      });
      toast({
        title: "File Read Error",
        description: `Could not read file ${file.name}.`,
        variant: "destructive",
      });
    };

    readNextChunk();
  };

  const sendFolderAsIndividualFiles = async (
    handle: FileSystemDirectoryHandle | FileList | File[],
    isFallback: boolean
  ) => {
    if (!profile || !state.selectedConversationId) return;

    if (isFallback) {
      // handle is a FileList or File[]
      for (const file of Array.from(handle as FileList)) {
        await sendFile(file);
      }
    } else {
      // handle is a FileSystemDirectoryHandle
      for await (const [, entry] of (
        handle as FileSystemDirectoryHandle
      ).entries()) {
        if (entry.kind === "file") {
          const file = await (entry as FileSystemFileHandle).getFile();
          await sendFile(file);
        }
      }
    }
  };

  const zipAndSendFolder = async (
    handle: FileSystemDirectoryHandle | FileList | File[],
    folderName: string,
    isFallback: boolean
  ) => {
    const TOAST_ID = "zipping-toast";
    const { dismiss, update } = toast({
      id: TOAST_ID, // Assign a unique ID to the toast
      description: (
        <div className="flex items-center">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Zipping folder...
        </div>
      ),
      duration: 999999,
      // You can add a close button or action here if needed
    });

    const zip = new JSZip();

    try {
      if (isFallback) {
        // handle is a FileList or File[] (from webkitdirectory or D&D fallback)
        for (const file of Array.from(handle as FileList)) {
          // Use webkitRelativePath to maintain folder structure if available
          const pathInZip = (file as any).webkitRelativePath || file.name;
          zip.file(pathInZip, file);
        }
      } else {
        // handle is a FileSystemDirectoryHandle
        const addFolderToZip = async (
          currentHandle: FileSystemDirectoryHandle,
          zipFolder: JSZip
        ) => {
          for await (const [name, entry] of currentHandle.entries()) {
            if (entry.kind === "file") {
              const file = await (entry as FileSystemFileHandle).getFile();
              zipFolder.file(name, file);
            } else if (entry.kind === "directory") {
              const subFolderHandle = entry as FileSystemDirectoryHandle;
              const subFolder = zipFolder.folder(name);
              if (subFolder) {
                await addFolderToZip(subFolderHandle, subFolder);
              }
            }
          }
        };
        await addFolderToZip(
          handle as FileSystemDirectoryHandle,
          zip.folder(folderName)!
        );
      }

      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        onUpdate: (metadata) => {
          // ADDED: onUpdate callback for progress
          update({
            id: TOAST_ID,
            description: (
              <div className="flex items-center">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Zipping "{truncateFileName(metadata.currentFile || "...", 20)}"
                ({Math.round(metadata.percent)}%)
                <Progress value={metadata.percent} className="w-24 ml-2 h-2" />
              </div>
            ),
          });
        },
      });

      update({
        // Update once zipping is complete
        id: TOAST_ID,
        title: "Zipping Complete",
        description: "Zipping complete. Starting transfer...",
        duration: 3000,
      });

      const zipFile = new File([blob], `${folderName}.zip`, {
        type: "application/zip",
      });
      await sendFile(zipFile);
      // dismiss() is implicitly called by the next toast or by duration if not updated.
      // For clarity, we can add a short delay and then dismiss, or let the next toast replace it.
      // setTimeout(() => dismiss(), 3000); // Or let the next toast for file transfer take over.
    } catch (error) {
      console.error("Error zipping folder:", error);
      dismiss(); // Dismiss the toast on error
      toast({
        title: "Zipping Failed",
        description: "An error occurred while creating the zip file.",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  const downloadFile = async (fileInfo: FileInfo) => {
    const storedFile = await db.files.get(fileInfo.id);
    if (storedFile) {
      const url = URL.createObjectURL(storedFile.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileInfo.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      toast({
        title: "Download Error",
        description: "File not found in local storage.",
        variant: "destructive",
      });
    }
  };

  const clearConversationMessages = useCallback(
    async (peerId: string) => {
      // ADDED
      await db.messages.where({ conversationId: peerId }).delete();
      // Also delete associated files from the db.files store
      const messagesToDelete = state.messages[peerId] || [];
      for (const msg of messagesToDelete) {
        if (msg.fileInfo?.id) {
          await db.files.delete(msg.fileInfo.id);
        }
      }
      dispatch({ type: "CLEAR_CONVERSATION_MESSAGES", payload: peerId });
      toast({
        title: "Chat Cleared",
        description: "Message history for this conversation has been removed.",
      });
    },
    [dispatch, state.messages, toast]
  );

  const deletePeer = useCallback(
    async (peerId: string) => {
      // ADDED
      // Disconnect if currently connected
      // PeerJS doesn't expose a direct way to close a specific connection by ID from the Peer object
      // You might need to manage connectionsRef.current directly if you want to explicitly close.
      // For now, simply removing from DB and state is sufficient as PeerJS will handle cleanup on its own eventually.

      await db.peers.delete(peerId);
      await db.messages.where({ conversationId: peerId }).delete();
      // Also delete associated files from the db.files store
      const messagesToDelete = state.messages[peerId] || [];
      for (const msg of messagesToDelete) {
        if (msg.fileInfo?.id) {
          await db.files.delete(msg.fileInfo.id);
        }
      }
      dispatch({ type: "DELETE_PEER", payload: peerId });
      toast({
        title: "Peer Removed",
        description: "The peer and conversation history have been deleted.",
      });
    },
    [dispatch, state.messages, toast]
  );

  return {
    state,
    connectToPeer,
    addAndConnectToPeer,
    selectConversation,
    sendMessage,
    sendFile,
    sendFolderAsIndividualFiles,
    zipAndSendFolder,
    downloadFile,
    sendTypingStatus, // ADDED
    clearConversationMessages, // ADDED
    deletePeer, // ADDED
  };
}

// --- Components ---

function WelcomeModal({
  onProfileCreate,
}: {
  onProfileCreate: (name: string) => Promise<any>;
}) {
  const [name, setName] = useState<string>("");
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    await onProfileCreate(name);
    // isCreating will stay true as the component unmounts
  };
  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-[425px] bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-700 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Welcome to P2P Chat
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            Create your profile to start connecting with peers securely.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="name" className="text-slate-200 font-medium">
            Display Name
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-slate-800 border-slate-600 text-white focus:border-blue-400 focus:ring-blue-400/20 mt-2"
            placeholder="Enter your name"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <DialogFooter>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !name.trim()}
            className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-medium w-full"
          >
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Get Started
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ZipConfirmationDialogProps {
  folderName: string;
  onConfirmZip: (
    handle: FolderToSend["handle"],
    name: string,
    isFallback: boolean
  ) => void;
  onConfirmIndividual: (
    handle: FolderToSend["handle"],
    isFallback: boolean
  ) => void;
  onCancel: () => void;
  folderHandle: FolderToSend["handle"];
  isFallback: boolean;
}

function ZipConfirmationDialog({
  folderName,
  onConfirmZip,
  onConfirmIndividual,
  onCancel,
  folderHandle,
  isFallback,
}: ZipConfirmationDialogProps) {
  return (
    <Dialog open={true} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-[45%] bg-slate-800 text-white border-slate-700">
        <DialogHeader>
          <DialogTitle>Send Folder '{folderName}'</DialogTitle>
          <DialogDescription>
            Do you want to send this folder as a single compressed .zip file, or
            send all files individually?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row sm:justify-end gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirmIndividual(folderHandle, isFallback)}
            className="w-full sm:w-auto"
          >
            Send Individually (Faster)
          </Button>
          <Button
            onClick={() => onConfirmZip(folderHandle, folderName, isFallback)}
            className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
          >
            <Archive className="mr-2 h-4 w-4" /> Yes, Zip and Send (Manageable)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Sidebar Component (now responsive) ---
function Sidebar({
  profile,
  peers,
  selectedConversationId,
  onSelectConversation,
  onAddPeer,
  onConnectToPeer,
}: {
  profile: UserProfile;
  peers: PeerData[];
  selectedConversationId: string | null;
  onSelectConversation: (peerId: string) => void;
  onAddPeer: (peerId: string) => void;
  onConnectToPeer: (peerId: string) => void;
}) {
  const [newPeerId, setNewPeerId] = useState("");
  const { toast } = useToast();

  const copyIdToClipboard = () => {
    navigator.clipboard.writeText(profile.id);
    toast({
      title: "Copied!",
      description: "Your Peer ID has been copied to the clipboard.",
    });
  };

  const handleAddClick = () => {
    if (newPeerId.trim()) {
      onAddPeer(newPeerId.trim());
      setNewPeerId("");
    }
  };

  const connectToAllOffline = () => {
    const offlinePeers = peers.filter((p) => p.status === "offline");
    if (offlinePeers.length === 0) {
      toast({
        title: "No Offline Peers",
        description: "All known peers are already online or connecting.",
      });
      return;
    }
    toast({
      title: "Connecting...",
      description: `Attempting to connect to ${offlinePeers.length} offline peers.`,
    });
    offlinePeers.forEach((p) => onConnectToPeer(p.id));
  };

  const getStatusIndicator = (status: PeerData["status"]) => {
    switch (status) {
      case "online":
        return (
          <span
            className="absolute bottom-0 right-0 block h-2.5 w-2.5 md:h-3 md:w-3 rounded-full bg-green-500 border-2 border-slate-900" // ADJUSTED SIZE
            title="Online"
          ></span>
        );
      case "offline":
        return (
          <span
            className="absolute bottom-0 right-0 block h-2.5 w-2.5 md:h-3 md:w-3 rounded-full bg-gray-500 border-2 border-slate-900" // ADJUSTED SIZE
            title="Offline"
          ></span>
        );
      case "connecting":
        return (
          <Loader2 className="absolute bottom-0 right-0 h-3 w-3 md:h-3.5 md:w-3.5 animate-spin text-yellow-400 bg-slate-900 rounded-full" /> // ADJUSTED SIZE
        );
    }
  };

  // UPDATED: Removed fixed width classes, now takes full width of parent
  return (
    <aside className="w-full h-full bg-slate-900 flex flex-col p-4 border-r border-slate-700/50">
      <div className="mb-4 flex-shrink-0">
        <h2 className="text-lg sm:text-xl font-bold text-white">
          {profile.name}
        </h2>{" "}
        {/* ADJUSTED FONT SIZE */}
        <div className="text-sm text-gray-400 flex items-center gap-2">
          <span>ID: {profile.id}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-gray-400 hover:text-white"
            onClick={copyIdToClipboard}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="mb-4 flex-shrink-0">
        <Label
          htmlFor="peer-id-input"
          className="text-base sm:text-lg font-semibold mb-2 block" // ADJUSTED FONT SIZE
        >
          Connect to Peer
        </Label>
        <div className="flex gap-2">
          <Input
            id="peer-id-input"
            placeholder="Enter Peer ID"
            value={newPeerId}
            onChange={(e) => setNewPeerId(e.target.value)}
            className="bg-slate-800 border-slate-600 focus:border-blue-400"
            onKeyDown={(e) => e.key === "Enter" && handleAddClick()}
          />
          <Button
            onClick={handleAddClick}
            disabled={!newPeerId.trim()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <h3 className="text-base sm:text-lg font-semibold">Peers</h3>{" "}
        {/* ADJUSTED FONT SIZE */}
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 hover:bg-slate-700/50"
          onClick={connectToAllOffline}
          title="Connect to all offline peers"
        >
          <Zap className="h-4 w-4 mr-2" /> Connect All
        </Button>
      </div>
      <ScrollArea className="flex-1 -mx-2">
        <div className="px-2">
          {peers.length === 0 && (
            <p className="text-gray-400 text-sm p-2 text-center">
              Add a peer to get started.
            </p>
          )}
          {peers.map((peer) => (
            <div
              key={peer.id}
              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors mb-2 ${
                selectedConversationId === peer.id
                  ? "bg-blue-600/80"
                  : "hover:bg-slate-700/50"
              }`}
              onClick={() => onSelectConversation(peer.id)}
            >
              <div className="flex items-center overflow-hidden">
                <div className="relative flex-shrink-0">
                  <Avatar className="h-9 w-9 md:h-10 md:w-10">
                    {" "}
                    {/* ADJUSTED AVATAR SIZE */}
                    <AvatarFallback>
                      {peer.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {getStatusIndicator(peer.status)}
                </div>
                <div className="ml-3 truncate">
                  <p className="font-medium truncate">{peer.name}</p>
                  <p className="text-xs text-slate-300 truncate">
                    {peer.status === "offline" && peer.lastSeen
                      ? `Last seen: ${new Date(
                          peer.lastSeen
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : titleCase(peer.status)}
                  </p>
                </div>
              </div>
              <div className="flex items-center flex-shrink-0 ml-2">
                {peer.unreadCount > 0 && (
                  <div className="bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center mr-2">
                    {peer.unreadCount}
                  </div>
                )}
                {peer.status === "offline" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-white"
                    title={`Reconnect to ${peer.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onConnectToPeer(peer.id);
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                {peer.status === "connecting" && (
                  <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

// --- MessageBubble Component ---
function MessageBubble({
  message,
  isMe,
  transfer,
  onDownloadFile,
}: {
  message: Message;
  isMe: boolean;
  transfer?: FileTransfer;
  onDownloadFile: (fileInfo: FileInfo) => void;
}) {
  const { toast } = useToast(); // ADDED
  const [showCopyButton, setShowCopyButton] = useState(false); // ADDED

  const renderStatusIcon = () => {
    if (!isMe) return null;
    switch (message.status) {
      case "pending":
        return <Hourglass className="h-3 w-3 text-gray-400" />;
      case "sent":
        return <CheckCircle className="h-3 w-3 text-gray-400" />;
      case "delivered":
        return <CheckCircle className="h-3 w-3 text-blue-400" />;
      case "failed":
        return <XCircle className="h-3 w-3 text-red-400" />;
      default:
        return null;
    }
  };

  const renderFileTransferStatus = () => {
    // ADDED for more detailed status
    if (!transfer) return null;

    switch (transfer.status) {
      case "transferring":
      case "receiving":
        return (
          <div className="w-28 text-center">
            <Progress value={transfer.progress} className="h-2" />
            <p className="text-xs mt-1">
              {titleCase(transfer.status)}... {Math.round(transfer.progress)}%
            </p>
          </div>
        );
      case "completed":
        return !isMe ? (
          <Button
            size="sm"
            onClick={() => onDownloadFile(message.fileInfo!)}
            className="bg-green-600 hover:bg-green-700"
          >
            <Download className="mr-2 h-4 w-4" /> Download
          </Button>
        ) : (
          <CheckCircle className="h-5 w-5 text-green-400" />
        );
      case "failed":
        return (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <XCircle className="h-4 w-4" />
            Failed
          </p>
        );
      case "queued":
        return (
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Hourglass className="h-4 w-4 animate-pulse" />
            Queued
          </p>
        );
      // Add other statuses if needed
      default:
        return null;
    }
  };

  // ADDED: Copy text message content
  const copyTextToClipboard = () => {
    if (message.type === "text") {
      navigator.clipboard.writeText(message.content);
      toast({
        title: "Copied!",
        description: "Message content copied to clipboard.",
        duration: 2000,
      });
    }
  };

  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] sm:max-w-md lg:max-w-xl p-3 rounded-lg relative ${
          isMe ? "bg-blue-600" : "bg-slate-700"
        }`}
        onMouseEnter={() => setShowCopyButton(true)} // ADDED
        onMouseLeave={() => setShowCopyButton(false)} // ADDED
      >
        {!isMe && (
          <p className="text-sm font-semibold text-indigo-300 mb-1">
            {message.senderName}
          </p>
        )}
        {message.type === "text" && (
          <>
            <p className="whitespace-pre-wrap break-words ">
              {message.content}
            </p>
            {showCopyButton && ( // ADDED: Copy button on hover
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6 text-gray-200 hover:text-white bg-black/20 hover:bg-black/30"
                onClick={copyTextToClipboard}
                title="Copy message"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
        {message.type === "file-transfer" && message.fileInfo && (
          <div className="flex overflow-auto max-w-[14rem] flex-col items-center gap-3">
            {getFileIcon(message.fileInfo.type)}
            <div className="text-center px-1">
              <p className="font-medium break-words text-sm">
                {message.fileInfo.name}
              </p>
              <p className="text-xs text-gray-300">
                {formatBytes(message.fileInfo.size)}
              </p>
            </div>
            {renderFileTransferStatus()}
          </div>
        )}
      </div>
      <div className="text-xs text-gray-400 mt-1 px-1 flex items-center gap-1">
        <span>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {renderStatusIcon()}
      </div>
    </div>
  );
}

// --- ChatWindow Component (now responsive) ---
function ChatWindow({
  profile,
  selectedConversationId,
  messages,
  fileTransfers,
  peers,
  onSendMessage,
  onSendFile,
  onSendFolderAsIndividualFiles,
  onZipAndSendFolder,
  onDownloadFile,
  onBack, // ADDED: For mobile navigation
  onSendTypingStatus, // ADDED
  onClearConversationMessages, // ADDED
  onDeletePeer, // ADDED
  isPeerTyping, // ADDED
}: {
  profile: UserProfile;
  selectedConversationId: string | null;
  messages: Message[];
  fileTransfers: Record<string, FileTransfer>;
  peers: Record<string, PeerData>;
  onSendMessage: (content: string) => void;
  onSendFile: (file: File) => void;
  onSendFolderAsIndividualFiles: (
    handle: FolderToSend["handle"],
    isFallback: boolean
  ) => void;
  onZipAndSendFolder: (
    handle: FolderToSend["handle"],
    name: string,
    isFallback: boolean
  ) => void;
  onDownloadFile: (fileInfo: FileInfo) => void;
  onBack?: () => void; // ADDED: Optional prop
  onSendTypingStatus: (isTyping: boolean) => void; // ADDED
  onClearConversationMessages: (peerId: string) => void; // ADDED
  onDeletePeer: (peerId: string) => void; // ADDED
  isPeerTyping: boolean; // ADDED
}) {
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [folderToSend, setFolderToSend] = useState<FolderToSend | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null); // New ref for webkitdirectory input
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null); // ADDED: Ref for message input
  const dragOverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null); // ADDED: For debouncing typing status

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    // ADDED: Focus input on conversation select
    if (selectedConversationId) {
      messageInputRef.current?.focus();
    }
  }, [selectedConversationId]);

  const handleSend = () => {
    if (currentMessage.trim()) {
      onSendMessage(currentMessage);
      setCurrentMessage("");
    }
  };

  // ADDED: Typing status logic for input field
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentMessage(e.target.value);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    onSendTypingStatus(true); // Send typing status immediately

    typingTimeoutRef.current = setTimeout(() => {
      onSendTypingStatus(false); // Send not typing after a delay
    }, 1500); // 1.5 seconds debounce
  };

  const handleInputBlur = () => {
    // ADDED: Stop typing when input loses focus
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    onSendTypingStatus(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // If multiple files are selected from a single input, send them individually
      for (const file of Array.from(e.target.files)) {
        onSendFile(file);
      }
    }
    e.target.value = "";
  };

  // Handler for the webkitdirectory input fallback
  const handleFolderChangeFallback = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      // Heuristic to get folder name from webkitRelativePath
      const firstFile = files[0];
      const folderName = firstFile.webkitRelativePath
        ? firstFile.webkitRelativePath.split("/")[0]
        : "Dropped Folder";
      setFolderToSend({ handle: files, name: folderName, isFallback: true });
    }
    e.target.value = "";
  };

  const handleFolderPick = async () => {
    if ("showDirectoryPicker" in window) {
      try {
        const folderHandle = await (window as any).showDirectoryPicker();
        setFolderToSend({
          handle: folderHandle,
          name: folderHandle.name,
          isFallback: false,
        });
      } catch (err: any) {
        if (err.name === "AbortError") {
          console.info("Folder picker was cancelled by the user.");
        } else {
          console.error("Error picking folder:", err);
          alert(
            "An error occurred while picking the folder. Please try again."
          );
        }
      }
    } else {
      // Fallback for browsers that don't support showDirectoryPicker
      folderInputRef.current?.click();
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
      if (dragOverTimeoutRef.current) {
        clearTimeout(dragOverTimeoutRef.current);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current);
    }
    dragOverTimeoutRef.current = setTimeout(() => {
      setIsDraggingOver(false);
    }, 50); // Small delay to avoid flickers
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      if (dragOverTimeoutRef.current) {
        clearTimeout(dragOverTimeoutRef.current);
      }

      if (e.dataTransfer.items) {
        const items = Array.from(e.dataTransfer.items);
        let folderDetected = false;
        let filesToProcess: File[] = [];

        for (const item of items) {
          if (item.kind === "file") {
            const entry = item.webkitGetAsEntry();
            if (entry) {
              if (entry.isDirectory) {
                folderDetected = true;
                // Recursively get files from the dropped directory entry
                const files = await getFilesFromDirectoryEntry(
                  entry as FileSystemDirectoryEntry
                );
                // Use the directory name for the folder and treat as fallback for consistent processing
                setFolderToSend({
                  handle: files,
                  name: entry.name,
                  isFallback: true,
                });
                break; // Assuming only one top-level folder is dropped at a time
              } else {
                const file = item.getAsFile();
                if (file) {
                  filesToProcess.push(file);
                }
              }
            } else {
              // Fallback for items that don't have webkitGetAsEntry but are files
              const file = item.getAsFile();
              if (file) {
                filesToProcess.push(file);
              }
            }
          }
        }

        if (folderDetected) {
          // Handled by setFolderToSend above
        } else if (filesToProcess.length > 0) {
          for (const file of filesToProcess) {
            onSendFile(file);
          }
        }
      } else if (e.dataTransfer.files) {
        // Fallback if DataTransfer.items is not available (older browsers)
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) {
          const firstFile = droppedFiles[0];
          // Heuristic for dropped folder: if all files have webkitRelativePath
          const mightBeFolder = droppedFiles.every(
            (f) => (f as any).webkitRelativePath
          );
          const folderName =
            mightBeFolder && (firstFile as any).webkitRelativePath
              ? (firstFile as any).webkitRelativePath.split("/")[0]
              : "";

          if (mightBeFolder && folderName) {
            setFolderToSend({
              handle: droppedFiles,
              name: folderName,
              isFallback: true,
            });
          } else {
            for (const file of droppedFiles) {
              onSendFile(file);
            }
          }
        }
      }
    },
    [onSendFile]
  );

  if (!selectedConversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-800 text-center p-4">
        <Zap size={64} className="mb-4 text-slate-500" />
        <h2 className="text-2xl font-bold text-slate-300">
          Welcome to P2P Chat
        </h2>
        <p className="text-gray-400 max-w-sm">
          Select a peer from the list to start a conversation, or add a new peer
          using their ID.
        </p>
      </div>
    );
  }

  const selectedPeer = peers[selectedConversationId];
  const getStatusInfo = (status?: PeerData["status"]) => {
    switch (status) {
      case "online":
        return { color: "bg-green-500", text: "Online" };
      case "offline":
        return { color: "bg-gray-500", text: "Offline" };
      case "connecting":
        return { color: "bg-yellow-500", text: "Connecting..." };
      default:
        return { color: "bg-gray-500", text: "Unknown" };
    }
  };
  const statusInfo = getStatusInfo(selectedPeer?.status);

  return (
    <>
      {folderToSend && (
        <ZipConfirmationDialog
          folderName={folderToSend.name}
          onCancel={() => setFolderToSend(null)}
          onConfirmIndividual={onSendFolderAsIndividualFiles}
          onConfirmZip={onZipAndSendFolder}
          folderHandle={folderToSend.handle}
          isFallback={folderToSend.isFallback}
        />
      )}
      <div className="flex-1 flex flex-col bg-slate-800 min-h-0 h-full">
        {/* UPDATED: Header is now responsive */}
        <header className="flex-shrink-0 px-4 py-3 bg-slate-900/70 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center overflow-hidden">
            {/* ADDED: Back button for mobile */}
            {onBack && (
              <Button
                onClick={onBack}
                variant="ghost"
                size="icon"
                className="md:hidden mr-2"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="flex flex-col">
              <h2 className="text-lg sm:text-xl font-semibold text-white truncate">
                {" "}
                {/* ADJUSTED FONT SIZE */}
                {selectedPeer?.name ?? "Select a Chat"}
              </h2>
              {isPeerTyping && ( // ADDED: Typing indicator
                <span className="text-xs text-blue-400 flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" /> Typing...
                </span>
              )}
            </div>
          </div>
          {selectedPeer && (
            <div className="flex items-center gap-2 text-sm flex-shrink-0">
              <span
                className={`h-2.5 w-2.5 rounded-full ${statusInfo.color}`}
              ></span>
              <span className="text-slate-300">{statusInfo.text}</span>
              <DropdownMenu>
                {" "}
                {/* ADDED: Dropdown for chat options */}
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-slate-700 border-slate-600 text-white"
                >
                  <DropdownMenuItem
                    onClick={() =>
                      onClearConversationMessages(selectedConversationId)
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Clear Chat
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDeletePeer(selectedConversationId)}
                  >
                    <UserPlus className="mr-2 h-4 w-4" /> Delete Peer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </header>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex-1 p-4 overflow-y-auto relative transition-all duration-100 ease-in-out ${
            isDraggingOver
              ? "border-4 border-dashed border-blue-500 bg-slate-700/50"
              : ""
          }`}
        >
          {isDraggingOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 text-lg sm:text-2xl font-bold pointer-events-none">
              {" "}
              {/* ADJUSTED FONT SIZE */}
              Drop files or folders here to send
            </div>
          )}
          <div className="space-y-4">
            {messages.length === 0 ? ( // ADDED: Empty chat state
              <div className="flex flex-col items-center justify-center h-full text-gray-400 mt-20">
                <MessageSquare className="h-16 w-16 mb-4" />
                <p className="text-lg font-medium">
                  Start a conversation with {selectedPeer?.name}
                </p>
                <p className="text-sm">Send a message or share a file!</p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div
                  key={msg.id ?? msg.tempId ?? index}
                  className={`flex ${
                    msg.senderId === profile.id
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <MessageBubble
                    message={msg}
                    isMe={msg.senderId === profile.id}
                    transfer={
                      msg.fileInfo ? fileTransfers[msg.fileInfo.id] : undefined
                    }
                    onDownloadFile={onDownloadFile}
                  />
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        {selectedPeer?.status === "online" ? (
          <footer className="flex-shrink-0 p-4 bg-slate-900/70 border-t border-slate-700/50">
            <div className="flex items-center gap-2 bg-slate-700 rounded-xl p-2">
              <Input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                multiple // Allows selecting multiple files
              />
              <Input
                type="file"
                ref={folderInputRef}
                onChange={handleFolderChangeFallback}
                className="hidden"
                // @ts-ignore
                webkitdirectory=""
                directory=""
                multiple
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file(s)"
              >
                <Paperclip className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleFolderPick}
                title="Attach folder"
              >
                <Archive className="w-5 h-5" />
              </Button>
              <Input
                placeholder={`Message ${selectedPeer?.name}...`}
                className="flex-1 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-white placeholder-gray-400"
                value={currentMessage}
                onChange={handleInputChange} // UPDATED
                onBlur={handleInputBlur} // ADDED
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                ref={messageInputRef} // ADDED
              />
              <Button
                onClick={handleSend}
                disabled={!currentMessage.trim()}
                className="bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                <Send className="w-5 h-5 text-white" />
              </Button>
            </div>
          </footer>
        ) : (
          <footer className="flex-shrink-0 p-4 bg-slate-900/70 border-t border-slate-700/50 text-center">
            <p className="text-slate-400 text-sm">
              Peer is offline. You cannot send messages.
            </p>
          </footer>
        )}
      </div>
    </>
  );
}

// --- AppLayout (now responsive) ---
function AppLayout({ profile }: { profile: UserProfile }) {
  const {
    state,
    connectToPeer,
    addAndConnectToPeer,
    selectConversation,
    sendMessage,
    sendFile,
    sendFolderAsIndividualFiles,
    zipAndSendFolder,
    downloadFile,
    sendTypingStatus, // ADDED
    clearConversationMessages, // ADDED
    deletePeer, // ADDED
  } = useChatManager(profile);

  const peersArray = Object.values(state.peers)
    .filter((p) => p.id !== profile.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const currentMessages =
    state.messages[state.selectedConversationId ?? ""] ?? [];

  return (
    <div className="main flex bg-[rgb(15,23,45)] flex-col border-b border-slate-700">
      <div className="flex bg-[rgb(15,23,45)] items-center justify-start ml-4 md:ml-8 my-4">
        {" "}
        {/* ADJUSTED ML FOR MOBILE */}
        {/* <Image
          src="@/app/Group8.png"
          alt=""
          width={50}
          height={50}
          className="mr-2"
        /> */}
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">
          {" "}
          {/* ADJUSTED FONT SIZE */}
          Omega Chat
        </h1>
      </div>
      {/* // UPDATED: This layout now handles mobile and desktop views */}
      <div className="flex h-screen w-screen bg-slate-900 text-white font-sans overflow-hidden">
        {/* Sidebar Container: On mobile, hidden if a chat is selected. Always shown on desktop. */}
        <div
          className={`
          ${state.selectedConversationId ? "hidden" : "flex"}
          md:flex flex-col flex-shrink-1 w-full md:w-1/4 md:min-w-[300px]
        `}
        >
          <Sidebar
            profile={profile}
            peers={peersArray}
            selectedConversationId={state.selectedConversationId}
            onSelectConversation={selectConversation}
            onAddPeer={addAndConnectToPeer}
            onConnectToPeer={connectToPeer}
          />
        </div>

        {/* ChatWindow Container: On mobile, only shown if a chat is selected. Always shown on desktop. */}
        <main
          className={`
          ${!state.selectedConversationId ? "hidden" : "flex"}
          md:flex flex-1 flex-col
        `}
        >
          <ChatWindow
            profile={profile}
            selectedConversationId={state.selectedConversationId}
            messages={currentMessages}
            fileTransfers={state.fileTransfers}
            peers={state.peers}
            onSendMessage={sendMessage}
            onSendFile={sendFile}
            onSendFolderAsIndividualFiles={sendFolderAsIndividualFiles}
            onZipAndSendFolder={zipAndSendFolder}
            onDownloadFile={downloadFile}
            onBack={() => selectConversation(null)} // This enables the back button on mobile
            onSendTypingStatus={sendTypingStatus} // ADDED
            onClearConversationMessages={clearConversationMessages} // ADDED
            onDeletePeer={deletePeer} // ADDED
            isPeerTyping={
              state.selectedConversationId
                ? state.typingStates[state.selectedConversationId] || false
                : false
            } // ADDED
          />
        </main>
      </div>{" "}
    </div>
  );
}

// --- Main Page Component ---
export default function Home() {
  const { profile, isLoading, createUserProfile } = useUserProfile();
  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-900">
        <Loader2 className="h-12 w-12 animate-spin text-white" />
        <Toaster />
      </div>
    );
  }

  if (!profile) {
    return (
      <>
        <WelcomeModal onProfileCreate={createUserProfile} />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <AppLayout profile={profile} />
      <Toaster />
    </>
  );
}
