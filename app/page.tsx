"use client";

import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import Peer, { DataConnection } from "peerjs";
import Dexie from "dexie";
import JSZip from "jszip";
import Image from "next/image";
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

// --- State & Action Types for Reducer ---
type ChatState = {
  peers: Record<string, PeerData>;
  messages: Record<string, Message[]>;
  fileTransfers: Record<string, FileTransfer>;
  selectedConversationId: string | null;
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
    };

// --- P2P Data Payload Type ---
type PeerMessagePayload =
  | { type: "profile-info"; payload: { id: string; name: string } }
  | { type: "text"; payload: { content: string } }
  | { type: "file-meta"; payload: FileInfo }
  | { type: "file-chunk"; payload: { id: string; chunk: ArrayBuffer } }
  | { type: "file-end"; payload: { id: string } };

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

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
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

  return { requestPermission, showNotification };
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
      return { ...state, peers: peersById, messages: messagesByConv };
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
  };
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const { toast } = useToast();
  const { requestPermission, showNotification } = useNotifications();
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
          showNotification(`New message from ${peerName}`, {
            body: data.payload.content,
          });
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
          showNotification(`Incoming file from ${peerName}`, {
            body: `${metadata.name} (${formatBytes(metadata.size)})`,
          });
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
      }
    },
    [profile, state.peers, toast, showNotification]
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
  };

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

  const sendFolderAsIndividualFiles = async (folderHandle: any) => {
    if (!state.selectedConversationId) return;
    for await (const entry of folderHandle.values()) {
      if (entry.kind === "file") {
        const file = await entry.getFile();
        await sendFile(file);
      }
    }
  };

  const zipAndSendFolder = async (folderHandle: any) => {
    const { dismiss, update } = toast({
      description: (
        <div className="flex items-center">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Zipping folder...
        </div>
      ),
      duration: 999999,
    });

    const zip = new JSZip();
    const addFolderToZip = async (handle: any, zipFolder: JSZip) => {
      for await (const entry of handle.values()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          zipFolder.file(entry.name, file);
        } else if (entry.kind === "directory") {
          const subFolder = zipFolder.folder(entry.name);
          if (subFolder) {
            await addFolderToZip(entry, subFolder);
          }
        }
      }
    };

    try {
      await addFolderToZip(folderHandle, zip.folder(folderHandle.name)!);
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      const zipFile = new File([blob], `${folderHandle.name}.zip`, {
        type: "application/zip",
      });
      update({
        id: "zipping-complete",
        title: "Zipping Complete",
        description: "Zipping complete. Starting transfer...",
        duration: 3000,
      });
      await sendFile(zipFile);
      dismiss();
    } catch (error) {
      console.error("Error zipping folder:", error);
      dismiss();
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

function ZipConfirmationDialog({
  folderName,
  onConfirmZip,
  onConfirmIndividual,
  onCancel,
}: {
  folderName: string;
  onConfirmZip: () => void;
  onConfirmIndividual: () => void;
  onCancel: () => void;
}) {
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
          <Button onClick={onConfirmIndividual} className="w-full sm:w-auto">
            Send Individually (Faster)
          </Button>
          <Button
            onClick={onConfirmZip}
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
            className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-green-500 border-2 border-slate-900"
            title="Online"
          ></span>
        );
      case "offline":
        return (
          <span
            className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-gray-500 border-2 border-slate-900"
            title="Offline"
          ></span>
        );
      case "connecting":
        return (
          <Loader2 className="absolute bottom-0 right-0 h-3.5 w-3.5 animate-spin text-yellow-400 bg-slate-900 rounded-full" />
        );
    }
  };

  // UPDATED: Removed fixed width classes, now takes full width of parent
  return (
    <aside className="w-full h-full bg-slate-900 flex flex-col p-4 border-r border-slate-700/50">
      <div className="mb-4 flex-shrink-0">
        <h2 className="text-xl font-bold text-white">{profile.name}</h2>
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
          className="text-lg font-semibold mb-2 block"
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
        <h3 className="text-lg font-semibold">Peers</h3>
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
                  <Avatar>
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

  const isTransferInProgress =
    transfer &&
    (transfer.status === "transferring" || transfer.status === "receiving");
  const isTransferCompleted = transfer?.status === "completed";
  const isTransferFailed = transfer?.status === "failed";

  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
      {/* UPDATED: Responsive max-width */}
      <div
        className={`max-w-[85%] sm:max-w-md lg:max-w-xl p-3 rounded-lg ${
          isMe ? "bg-blue-600" : "bg-slate-700"
        }`}
      >
        {!isMe && (
          <p className="text-sm font-semibold text-indigo-300 mb-1">
            {message.senderName}
          </p>
        )}
        {message.type === "text" && (
          <p className="whitespace-pre-wrap break-words ">{message.content}</p>
        )}
        {message.type === "file-transfer" && message.fileInfo && (
          <div className="flex min-w-[13rem] flex-col items-center gap-3">
            {getFileIcon(message.fileInfo.type)}
            <div>
              <p className="font-medium text-ellipsis text-center text-wrap">
                {message.fileInfo.name}
              </p>
              <p className="text-sm text-center text-gray-300">
                {formatBytes(message.fileInfo.size)}
              </p>
            </div>
            {isTransferInProgress && (
              <div className="w-28 text-center">
                <Progress value={transfer.progress} className="h-2" />
                <p className="text-xs mt-1">
                  {titleCase(transfer.status)}...{" "}
                  {Math.round(transfer.progress)}%
                </p>
              </div>
            )}
            {isTransferCompleted && !isMe && (
              <Button
                size="sm"
                onClick={() => onDownloadFile(message.fileInfo!)}
                className="bg-green-600 hover:bg-green-700"
              >
                <Download className="mr-2 h-4 w-4" /> Download
              </Button>
            )}
            {isTransferCompleted && isMe && (
              <CheckCircle className="h-5 w-5 text-green-400" />
            )}
            {isTransferFailed && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <XCircle className="h-4 w-4" />
                Failed
              </p>
            )}
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
}: {
  profile: UserProfile;
  selectedConversationId: string | null;
  messages: Message[];
  fileTransfers: Record<string, FileTransfer>;
  peers: Record<string, PeerData>;
  onSendMessage: (content: string) => void;
  onSendFile: (file: File) => void;
  onSendFolderAsIndividualFiles: (folderHandle: any) => void;
  onZipAndSendFolder: (folderHandle: any) => void;
  onDownloadFile: (fileInfo: FileInfo) => void;
  onBack?: () => void; // ADDED: Optional prop
}) {
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [folderToSend, setFolderToSend] = useState<{
    handle: any;
    name: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (currentMessage.trim()) {
      onSendMessage(currentMessage);
      setCurrentMessage("");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      onSendFile(e.target.files[0]);
    }
    e.target.value = "";
  };

  const handleFolderPick = async () => {
    // Note: showDirectoryPicker is not available in all browsers (e.g., Firefox)
    if ("showDirectoryPicker" in window) {
      try {
        const folderHandle = await (window as any).showDirectoryPicker();
        setFolderToSend({ handle: folderHandle, name: folderHandle.name });
      } catch (err) {
        console.info("Folder picker was cancelled by the user.");
      }
    } else {
      alert("Your browser does not support folder selection.");
    }
  };

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
          onConfirmIndividual={() => {
            onSendFolderAsIndividualFiles(folderToSend.handle);
            setFolderToSend(null);
          }}
          onConfirmZip={() => {
            onZipAndSendFolder(folderToSend.handle);
            setFolderToSend(null);
            alert(
              `${folderToSend.name} is being processed. It may take some time showing up on the ui depending on the size of app.\n\nDo not close this tab.\n\nYou can close this alert though`
            );
            //         <DialogDescription id="zipping-complete">
            // Your file is being processed. It may take some time showing up on the ui depending on the size of app. Do not close this tab            </DialogDescription>
          }}
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
            <h2 className="text-xl font-semibold text-white truncate">
              {selectedPeer?.name ?? "Select a Chat"}
            </h2>
          </div>
          {selectedPeer && (
            <div className="flex items-center gap-2 text-sm flex-shrink-0">
              <span
                className={`h-2.5 w-2.5 rounded-full ${statusInfo.color}`}
              ></span>
              <span className="text-slate-300">{statusInfo.text}</span>
            </div>
          )}
        </header>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((msg, index) => (
              <div
                key={msg.id ?? msg.tempId ?? index}
                className={`flex ${
                  msg.senderId === profile.id ? "justify-end" : "justify-start"
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
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
        {selectedPeer?.status === "online" ? (
          <footer className="flex-shrink-0 p-4 bg-slate-900/70 border-t border-slate-700/50">
            <div className="flex items-center gap-2 bg-slate-700 rounded-xl p-2">
              <Input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
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
                onChange={(e) => setCurrentMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
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
  } = useChatManager(profile);

  const peersArray = Object.values(state.peers)
    .filter((p) => p.id !== profile.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const currentMessages =
    state.messages[state.selectedConversationId ?? ""] ?? [];

  return (
    <div className="main flex flex-col">
      <div className="flex bg-[#1e293b] items-center justify-start ml-8 my-4">
        {/* <Image
          src="@/app/Group8.png"
          alt=""
          width={50}
          height={50}
          className="mr-2"
        /> */}
        <h1 className="text-3xl font-extrabold text-white tracking-wide">
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
