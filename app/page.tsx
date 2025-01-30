"use client";

import { useState, useEffect, useRef, ChangeEvent } from "react";
import { Peer, DataConnection } from "peerjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Send,
  Upload,
  Folder,
  UserPlus,
  Users,
  Download,
  Copy,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import Dexie from "dexie";
import { zipFiles } from "@/lib/zipUtils";

// Enhanced interfaces
interface Message {
  id?: number;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  type: "text" | "file";
  status: "sent" | "delivered" | "failed" | "pending";
  fileInfo?: {
    name: string;
    size: number;
    url?: string;
    hash?: string;
  };
  isGroup?: boolean;
  reactions?: { [key: string]: number };
}

interface PeerData {
  id: string;
  name: string;
  lastSeen: number;
  status: "online" | "offline";
  groups?: string[];
  customAvatar?: string;
  deviceInfo?: string;
  unreadMessages?: number;
}

interface FileTransfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  data: ArrayBuffer[];
  senderName: string;
  conversationId: string;
  status: "pending" | "transferring" | "completed" | "failed";
  retryCount: number;
  hash?: string;
}

interface UserProfile {
  id: string;
  name: string;
  avatar?: string;
  preferences: {
    theme: "light" | "dark";
    autoDownload: boolean;
    notifications: boolean;
    maxPeers: number;
  };
}

interface Group {
  id: string;
  name: string;
  members: string[];
}

// Enhanced database schema with additional tables
class MessagingDB extends Dexie {
  messages!: Dexie.Table<Message, number>;
  peers!: Dexie.Table<PeerData, string>;
  profile!: Dexie.Table<UserProfile, string>;
  fileTransfers!: Dexie.Table<FileTransfer, string>;

  constructor() {
    super("MessagingDB");
    this.version(1).stores({
      messages: "++id, conversationId, senderId, timestamp, status",
      peers: "id, name, lastSeen, status",
      profile: "id, name",
      fileTransfers: "id, conversationId, status",
    });
  }
}

const db = new MessagingDB();

// Constants
const MAX_PEERS = 100;
const MAX_RETRY_ATTEMPTS = 3;
const CHUNK_SIZE = 65536; // Increased chunk size for better performance
const HEARTBEAT_INTERVAL = 30000;
const CONNECTION_TIMEOUT = 10000;

const generatePeerId = () => {
  // Generate a 4-digit numeric ID
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export default function Home() {
  const [peerId, setPeerId] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [remotePeers, setRemotePeers] = useState<PeerData[]>([]);
  const [newPeerId, setNewPeerId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [isInGroup, setIsInGroup] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [fileTransfers, setFileTransfers] = useState<Record<string, FileTransfer>>({});
  const [autoDownload, setAutoDownload] = useState(true);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [peerConnectionCount, setPeerConnectionCount] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [conversationType, setConversationType] = useState<"group" | "individual">("individual");

  const peerRef = useRef<Peer>();
  const connectionsRef = useRef<Record<string, DataConnection>>({});
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const heartbeatRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  // Initialize user profile and peer ID
  useEffect(() => {
    const initializeUser = async () => {
      try {
        // Try to load existing profile
        const profiles = await db.profile.toArray();
        let profile = profiles[0];

        if (!profile) {
          // Create new profile if none exists
          const savedName = localStorage.getItem("displayName");
          const name = savedName || prompt("Enter your display name:");
          if (!name) return;

          const newId = generatePeerId();
          profile = {
            id: newId,
            name,
            preferences: {
              theme: "dark",
              autoDownload: true,
              notifications: true,
              maxPeers: MAX_PEERS,
            },
          };

          await db.profile.add(profile);
          localStorage.setItem("displayName", name);
        }

        setDisplayName(profile.name);
        setPeerId(profile.id);
        setAutoDownload(profile.preferences.autoDownload);
      } catch (error) {
        console.error("Error initializing user:", error);
        toast({
          title: "Error",
          description: "Failed to initialize user profile. Please try again.",
          variant: "destructive",
        });
      }
    };

    initializeUser();
  }, []);

  // Initialize peer connection
  useEffect(() => {
    if (!displayName || !peerId) return;

    const initializePeer = () => {
      const peer = new Peer(peerId, {
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
        },
        debug: 2,
      });

      peer.on("open", async (id) => {
        setConnectionStatus("ready");
        await db.peers.put({
          id,
          name: displayName,
          lastSeen: Date.now(),
          status: "online",
        });
        reconnectToPeers();
        sendPendingMessages();
      });

      peer.on("connection", handleNewConnection);
      peer.on("error", handlePeerError);
      peer.on("disconnected", handleDisconnect);
      peer.on("close", () => {
        if (peerRef.current) {
          peerRef.current.destroy();
        }
      });

      peerRef.current = peer;

      // Start heartbeat
      heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

      return () => {
        clearInterval(heartbeatRef.current);
        peer.destroy();
      };
    };

    initializePeer();
  }, [displayName, peerId]);

  // Load conversation messages
  useEffect(() => {
    const loadConversation = async () => {
      if (selectedConversation) {
        try {
          const messages = await db.messages
            .where("conversationId")
            .equals(selectedConversation)
            .sortBy("timestamp");
          setMessages(messages);

          // Mark messages as delivered
          await db.messages
            .where("conversationId")
            .equals(selectedConversation)
            .modify({ status: "delivered" });
        } catch (error) {
          console.error("Error loading conversation:", error);
          toast({
            title: "Error",
            description: "Failed to load conversation messages.",
            variant: "destructive",
          });
        }
      }
    };

    loadConversation();
  }, [selectedConversation]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendHeartbeat = () => {
    Object.values(connectionsRef.current).forEach((conn) => {
      conn.send({
        type: "heartbeat",
        timestamp: Date.now(),
      });
    });
  };

  const handleNewConnection = async (conn: DataConnection) => {
    if (peerConnectionCount >= MAX_PEERS || connectionsRef.current[conn.peer]) {
      conn.close();
      toast({
        title: "Connection Limit Reached",
        description: `Maximum number of peers (${MAX_PEERS}) reached or already connected.`,
        variant: "destructive",
      });
      return;
    }

    // Set connection timeout
    const timeout = setTimeout(() => {
      if (conn.open) {
        conn.close();
        handleConnectionError(conn.peer, new Error("Connection timeout"));
      }
    }, CONNECTION_TIMEOUT);

    conn.on("open", () => clearTimeout(timeout));

    conn.on("open", async () => {
      conn.send({ type: "profile", id: peerId, name: displayName, deviceInfo: navigator.userAgent });

      try {
        const existingPeer = await db.peers.get(conn.peer);
        if (!existingPeer) {
          await db.peers.add({
            id: conn.peer,
            name: conn.peer,
            lastSeen: Date.now(),
            status: "online",
          });
        } else {
          await db.peers.update(conn.peer, {
            lastSeen: Date.now(),
            status: "online",
          });
        }

        connectionsRef.current[conn.peer] = conn;
        setupConnectionListeners(conn);
        setPeerConnectionCount((count) => count + 1);
        setRemotePeers((prev) => [
          ...prev,
          { id: conn.peer, name: conn.peer, status: "online", lastSeen: Date.now(), unreadMessages: 0 },
        ]);
        setConnectionStatus("connected");
      } catch (error) {
        console.error("Error handling new connection:", error);
        handleConnectionError(conn.peer, error);
      }
    });

    setupConnectionListeners(conn);
  };

  const setupConnectionListeners = (conn: DataConnection) => {
    conn.on("data", async (data: any) => {
      try {
        if (data.type === "profile") {
          await db.peers.update(data.id, {
            name: data.name,
            deviceInfo: data.deviceInfo,
            status: "online",
          });
          setRemotePeers((prev) =>
            prev.map((p) =>
              p.id === data.id
                ? { ...p, name: data.name, deviceInfo: data.deviceInfo }
                : p
            )
          );
        } else if (data.type === "heartbeat") {
          await db.peers.update(conn.peer, { lastSeen: data.timestamp });
        } else if (data.type === "groupUpdate") {
          switch (data.action) {
            case "create":
              setGroups((prev) => [...prev, data.group]);
              break;
            case "join":
              setGroups((prev) =>
                prev.map((g) =>
                  g.id === data.groupId
                    ? { ...g, members: [...g.members, data.memberId] }
                    : g
                )
              );
              break;
          }
        } else {
          handleIncomingData(conn.peer, data);
        }
      } catch (error) {
        console.error("Error processing incoming data:", error);
        toast({
          title: "Error",
          description: "Failed to process incoming data.",
          variant: "destructive",
        });
      }
    });

    conn.on("close", () => handleConnectionClose(conn.peer));
    conn.on("error", (error) => handleConnectionError(conn.peer, error));
  };

  const handleIncomingData = async (senderId: string, data: any) => {
    const conversationId = data.groupId || selectedConversation || senderId;

    try {
      if (data.type === "text") {
        const message: Message = {
          conversationId,
          senderId,
          senderName:
            remotePeers.find((p) => p.id === senderId)?.name || senderId,
          content: data.content,
          timestamp: Date.now(),
          type: "text",
          status: "delivered",
          isGroup: !!data.groupId,
        };

        await db.messages.add(message);
        setMessages((prev) => [...prev, message]);
      } else if (data.type === "file-start") {
        const { id, name, size, hash } = data;
        setFileTransfers((prev) => ({
          ...prev,
          [id]: {
            id,
            name,
            size,
            hash,
            progress: 0,
            data: [],
            senderName:
              remotePeers.find((p) => p.id === senderId)?.name || senderId,
            conversationId,
            status: "pending",
            retryCount: 0,
          },
        }));

        // Acknowledge file transfer start
        const conn = connectionsRef.current[senderId];
        if (conn) {
          conn.send({
            type: "file-ack",
            id,
            status: "ready",
          });
        }
      } else if (data.type === "file-chunk") {
        await handleIncomingFileChunk(data, senderId);
      } else if (data.type === "file-end") {
        await finalizeFileTransfer(data.id, senderId);
      }
    } catch (error) {
      console.error("Error handling incoming data:", error);
      toast({
        title: "Error",
        description: "Failed to process incoming data",
        variant: "destructive",
      });
    }
  };

  const handleIncomingFileChunk = async (
    data: { id: string; chunk: ArrayBuffer; index: number },
    senderId: string
  ) => {
    setFileTransfers((prev) => {
      const transfer = prev[data.id];
      if (!transfer) return prev;

      const newData = [...transfer.data];
      newData[data.index] = data.chunk;

      const chunksReceived = newData.filter(Boolean).length;
      const totalChunks = Math.ceil(transfer.size / CHUNK_SIZE);
      const progress = (chunksReceived / totalChunks) * 100;

      const updatedTransfer = {
        ...transfer,
        data: newData,
        progress,
        status: progress === 100 ? "completed" : "transferring",
      };

      // Auto download if enabled and transfer is complete
      if (progress === 100 && autoDownload) {
        downloadFile(updatedTransfer);
      }

      return { ...prev, [data.id]: updatedTransfer };
    });

    // Acknowledge chunk receipt
    const conn = connectionsRef.current[senderId];
    if (conn) {
      conn.send({
        type: "chunk-ack",
        id: data.id,
        index: data.index,
      });
    }
  };

  const finalizeFileTransfer = async (transferId: string, senderId: string) => {
    const transfer = fileTransfers[transferId];
    if (!transfer) return;

    try {
      // Verify file hash if provided
      if (transfer.hash) {
        const blob = new Blob(transfer.data);
        const arrayBuffer = await blob.arrayBuffer();
        const calculatedHash = await crypto.subtle.digest(
          "SHA-256",
          arrayBuffer
        );
        const hashMatches = compareHashes(calculatedHash, transfer.hash);

        if (!hashMatches) {
          throw new Error("File hash verification failed");
        }
      }

      // Save successful transfer to database
      await db.fileTransfers.put({
        ...transfer,
        status: "completed",
      });

      // Create message for the file
      const message: Message = {
        conversationId: transfer.conversationId,
        senderId,
        senderName: transfer.senderName,
        content: `File: ${transfer.name}`,
        timestamp: Date.now(),
        type: "file",
        status: "delivered",
        fileInfo: {
          name: transfer.name,
          size: transfer.size,
          hash: transfer.hash,
        },
      };

      await db.messages.add(message);
      setMessages((prev) => [...prev, message]);

      // Clean up transfer data
      setFileTransfers((prev) => {
        const { [transferId]: _, ...rest } = prev;
        return rest;
      });
    } catch (error) {
      console.error("Error finalizing file transfer:", error);
      handleFileTransferError(transferId, senderId, error);
    }
  };

  const handleFileTransferError = async (
    transferId: string,
    senderId: string,
    error: any
  ) => {
    setFileTransfers((prev) => {
      const transfer = prev[transferId];
      if (!transfer) return prev;

      if (transfer.retryCount < MAX_RETRY_ATTEMPTS) {
        // Retry transfer
        const conn = connectionsRef.current[senderId];
        if (conn) {
          conn.send({
            type: "file-retry",
            id: transferId,
          });
        }

        return {
          ...prev,
          [transferId]: {
            ...transfer,
            status: "pending",
            retryCount: transfer.retryCount + 1,
          },
        };
      } else {
        // Mark as failed after max retries
        toast({
          title: "File Transfer Failed",
          description: `Failed to receive file ${transfer.name} after ${MAX_RETRY_ATTEMPTS} attempts`,
          variant: "destructive",
        });

        return {
          ...prev,
          [transferId]: {
            ...transfer,
            status: "failed",
          },
        };
      }
    });
  };

  const sendMessage = async () => {
    if (!selectedConversation || !currentMessage.trim()) return;

    const isGroup = groups.some((g) => g.id === selectedConversation);
    const message: Message = {
      conversationId: selectedConversation,
      senderId: peerId,
      senderName: displayName,
      content: currentMessage.trim(),
      timestamp: Date.now(),
      type: "text",
      status: "sent",
      isGroup,
    };

    try {
      await db.messages.add(message);
      setMessages((prev) => [...prev, message]);

      if (isGroup) {
        // Send to all group members
        const group = groups.find((g) => g.id === selectedConversation);
        group?.members.forEach((memberId) => {
          if (memberId !== peerId) {
            const conn = connectionsRef.current[memberId];
            if (conn) {
              conn.send({
                type: "text",
                content: message.content,
                groupId: selectedConversation,
              });
            }
          }
        });
      } else {
        // Direct message
        const conn = connectionsRef.current[selectedConversation];
        if (conn) {
          conn.send({
            type: "text",
            content: message.content,
          });
        }
      }
      setCurrentMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (files: FileList) => {
    if (!selectedConversation) return;

    try {
      let dataToSend: Blob;
      let fileName: string;

      if (files.length > 1 || files[0].webkitRelativePath) {
        dataToSend = await zipFiles(Array.from(files));
        fileName = "transfer.zip";
      } else {
        dataToSend = files[0];
        fileName = files[0].name;
      }

      const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const arrayBuffer = await dataToSend.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashString = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Initialize file transfer
      const totalChunks = Math.ceil(dataToSend.size / CHUNK_SIZE);
      const chunks: ArrayBuffer[] = [];

      // Split file into chunks
      for (let i = 0; i < totalChunks; i++) {
        const chunk = dataToSend.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        chunks.push(await chunk.arrayBuffer());
      }

      // Send file info to the selected conversation peer only
      const conn = connectionsRef.current[selectedConversation];
      if (conn) {
        conn.send({
          type: "file-start",
          id: fileId,
          name: fileName,
          size: dataToSend.size,
          hash: hashString,
        });
      }

      // Track local progress
      setFileTransfers((prev) => ({
        ...prev,
        [fileId]: {
          id: fileId,
          name: fileName,
          size: dataToSend.size,
          progress: 0,
          data: [],
          senderName: displayName,
          conversationId: selectedConversation,
          status: "transferring",
          retryCount: 0,
          hash: hashString,
        },
      }));

      // Send chunks with acknowledgment
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await sendChunkWithRetry(fileId, chunk, i);

        setFileTransfers((prev) => ({
          ...prev,
          [fileId]: {
            ...prev[fileId],
            progress: ((i + 1) / chunks.length) * 100,
          },
        }));
      }

      // Send file completion message
      if (conn) {
        conn.send({
          type: "file-end",
          id: fileId,
        });
      }

      setFiles(null);
    } catch (error) {
      console.error("Error uploading file:", error);
      toast({
        title: "Error",
        description: "Failed to upload file",
        variant: "destructive",
      });
    }
  };

  const sendChunkWithRetry = async (
    fileId: string,
    chunk: ArrayBuffer,
    index: number,
    retryCount = 0
  ): Promise<void> => {
    try {
      const conn = connectionsRef.current[selectedConversation];
      if (conn) {
        const sendPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Chunk send timeout"));
          }, 5000);

          conn.send({
            type: "file-chunk",
            id: fileId,
            chunk,
            index,
          });

          // Wait for acknowledgment
          const handleAck = (data: any) => {
            if (
              data.type === "chunk-ack" &&
              data.id === fileId &&
              data.index === index
            ) {
              clearTimeout(timeout);
              conn.off("data", handleAck);
              resolve();
            }
          };

          conn.on("data", handleAck);
        });

        await sendPromise;
      }
    } catch (error) {
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return sendChunkWithRetry(fileId, chunk, index, retryCount + 1);
      }
      throw error;
    }
  };

  const downloadFile = async (transfer: FileTransfer) => {
    try {
      const blob = new Blob(transfer.data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = transfer.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setFileTransfers((prev) => {
        const { [transfer.id]: _, ...rest } = prev;
        return rest;
      });

      toast({
        title: "File Downloaded",
        description: `${transfer.name} has been downloaded successfully.`,
      });
    } catch (error) {
      console.error("Error downloading file:", error);
      toast({
        title: "Error",
        description: "Failed to download file",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      setConnectionStatus("disconnected");
      // Update peer status in database
      await db.peers
        .where("status")
        .equals("online")
        .modify({ status: "offline" });

      // Attempt to reconnect
      setTimeout(() => {
        if (peerRef.current) {
          peerRef.current.reconnect();
        }
      }, 5000);
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  };

  const handlePeerError = (error: any) => {
    console.error("Peer connection error:", error);
    toast({
      title: "Connection Error",
      description:
        "An error occurred with the peer connection. Please try again.",
      variant: "destructive",
    });
  };

  const handleConnectionClose = async (peerId: string) => {
    try {
      delete connectionsRef.current[peerId];
      setPeerConnectionCount((count) => count - 1);

      await db.peers.update(peerId, {
        status: "offline",
        lastSeen: Date.now(),
      });
      setRemotePeers((prev) =>
        prev.map((peer) =>
          peer.id === peerId ? { ...peer, status: "offline" } : peer
        )
      );

      if (Object.keys(connectionsRef.current).length === 0) {
        setConnectionStatus("ready");
      }
    } catch (error) {
      console.error("Error handling connection close:", error);
    }
  };

  const handleConnectionError = (peerId: string, error: any) => {
    console.error("Connection error:", error);
    toast({
      title: "Connection Error",
      description: `An error occurred with the connection to ${peerId}. Please try reconnecting.`,
      variant: "destructive",
    });
  };

  // Utility functions
  const compareHashes = (hash1: ArrayBuffer, hash2: string): boolean => {
    const hash1String = Array.from(new Uint8Array(hash1))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hash1String === hash2;
  };

  const isGroupConnection = (conn: Peer.DataConnection): boolean => {
    return activeGroup && conn.peer === activeGroup;
  };

  const createGroup = () => {
    const newGroupId = generatePeerId();
    const newGroup: Group = {
      id: newGroupId,
      name: `Group ${newGroupId.slice(0, 4)}`,
      members: [peerId],
    };

    setGroups((prev) => [...prev, newGroup]);
    setSelectedConversation(newGroupId);
    setActiveGroup(newGroupId);
    setConversationType("group");

    // Notify existing connections
    Object.values(connectionsRef.current).forEach((conn) => {
      conn.send({
        type: "groupUpdate",
        action: "create",
        group: newGroup,
      });
    });
  };

  const joinGroup = (inviterId: string, groupId: string) => {
    const conn = connectionsRef.current[inviterId];
    if (!conn) return;

    conn.send({
      type: "groupJoin",
      groupId,
    });
  };

  const leaveGroup = () => {
    Object.values(connectionsRef.current).forEach((conn) => conn.close());
    setGroups((prev) => prev.filter((g) => g.id !== activeGroup));
    setSelectedConversation(null);
    setActiveGroup(null);
    setConversationType("individual");
    setConnectionStatus("ready");
  };

  const connectToPeer = (id: string = newPeerId) => {
    if (!peerRef.current || !id || connectionsRef.current[id]) return;
    const conn = peerRef.current.connect(id);
    conn.on("open", () => {
      setupConnectionListeners(conn);
      connectionsRef.current[id] = conn;
      setRemotePeers((prev) => [
        ...prev,
        { id, name: id, status: "online", lastSeen: Date.now(), unreadMessages: 0 },
      ]);
      setNewPeerId("");
      setConnectionStatus("connected");
      toast({
        title: "Connected",
        description: `Successfully connected to peer ${id}.`,
      });
    });
  };

  const selectConversation = (id: string, isGroup?: boolean) => {
    setSelectedConversation(id);
    if (isGroup) {
      setActiveGroup(id);
      setConversationType("group");
    } else {
      setConversationType("individual");
    }
    setMessages([]); // Clear messages when switching peers
  };

  const reconnectToPeers = async () => {
    try {
      const peers = await db.peers.toArray();
      peers.forEach((peer) => {
        if (peer.status === "online") {
          connectToPeer(peer.id);
        }
      });
    } catch (error) {
      console.error("Error reconnecting to peers:", error);
    }
  };

  const sendPendingMessages = async () => {
    try {
      const pendingMessages = await db.messages
        .where("status")
        .equals("pending")
        .toArray();

      pendingMessages.forEach((message) => {
        const conn = connectionsRef.current[message.senderId];
        if (conn) {
          conn.send({
            type: "text",
            content: message.content,
          });
          db.messages.update(message.id!, { status: "sent" });
        }
      });
    } catch (error) {
      console.error("Error sending pending messages:", error);
    }
  };

  const addReaction = (messageId: number, reaction: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              reactions: {
                ...msg.reactions,
                [reaction]: (msg.reactions?.[reaction] || 0) + 1,
              },
            }
          : msg
      )
    );

    // Update in database
    db.messages.update(messageId, {
      reactions: {
        ...(prev.find((msg) => msg.id === messageId)?.reactions || {}),
        [reaction]: (prev.find((msg) => msg.id === messageId)?.reactions?.[reaction] || 0) + 1,
      },
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 flex flex-col md:flex-row">
      <div className="w-full md:w-1/4 p-4 bg-gray-800 rounded-md mb-4 md:mb-0">
        <h2 className="text-xl font-bold mb-4">Conversations</h2>
        <ScrollArea className="h-full bg-gray-700 rounded-md p-2">
          {/* Groups Section */}
          <div className="mb-4">
            <h3 className="font-medium mb-2">Groups</h3>
            {groups.map((group) => (
              <div
                key={group.id}
                className={`flex items-center space-x-2 mb-2 p-2 rounded-md cursor-pointer ${
                  selectedConversation === group.id ? "bg-blue-600" : "bg-gray-600"
                }`}
                onClick={() => selectConversation(group.id, true)}
              >
                <Users className="w-4 h-4" />
                <span>{group.name}</span>
              </div>
            ))}
          </div>

          {/* Individual Peers Section */}
          <h3 className="font-medium mb-2">Peers</h3>
          {remotePeers.map((peer) => (
            <div
              key={peer.id}
              className={`flex items-center space-x-2 mb-2 p-2 rounded-md cursor-pointer ${
                selectedConversation === peer.id ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => selectConversation(peer.id)}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback>{peer.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{peer.name}</p>
                <p className="text-xs text-gray-400">
                  Last seen: {new Date(peer.lastSeen).toLocaleTimeString()}
                </p>
                {peer.unreadMessages > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 ml-2">
                    {peer.unreadMessages}
                  </span>
                )}
              </div>
            </div>
          ))}
        </ScrollArea>
      </div>
      <div className="w-full md:w-3/4 p-4">
        <Card className="max-w-full mx-auto bg-gray-800">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">
              P2P File Transfer & Chat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="chat" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="connections">Connections</TabsTrigger>
              </TabsList>
              <TabsContent value="chat" className="space-y-4">
                <div className="h-[60vh] flex flex-col">
                  <ScrollArea
                    className="flex-grow mb-4 bg-gray-700 rounded-md p-2"
                    ref={chatScrollRef}
                  >
                    {messages.map((msg) => (
                      <div
                        key={msg.timestamp}
                        className={`mb-2 ${
                          msg.senderId === peerId ? "text-right" : "text-left"
                        }`}
                      >
                        <div
                          className={`inline-block p-2 rounded-md ${
                            msg.senderId === peerId
                              ? "bg-blue-600"
                              : "bg-gray-600"
                          }`}
                        >
                          <p className="text-sm text-gray-300">
                            {msg.senderName}
                          </p>
                          <p className="text-xs text-gray-400">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </p>
                          <div className="flex space-x-2 mt-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                addReaction(msg.id!, "thumbs-up")
                              }
                            >
                              <ThumbsUp className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                addReaction(msg.id!, "thumbs-down")
                              }
                            >
                              <ThumbsDown className="w-4 h-4" />
                            </Button>
                          </div>
                          {msg.type === "file" ? (
                            <div className="flex items-center">
                              <span>{msg.content}</span>
                              <Button
                                size="sm"
                                className="ml-2"
                                onClick={() => downloadFile(msg.fileInfo!)}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <p>{msg.content}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                  <div className="flex space-x-2">
                    <Input
                      type="file"
                      onChange={(e) => setFiles(e.target.files)}
                      className="bg-gray-700 text-white flex-grow"
                      multiple
                    />
                    <Button
                      onClick={() =>
                        document.getElementById("folderInput")?.click()
                      }
                      disabled={connectionStatus !== "connected"}
                    >
                      <Folder className="w-4 h-4 mr-2" />
                      Select Folder
                    </Button>
                    <input
                      id="folderInput"
                      type="file"
                      onChange={(e) => setFiles(e.target.files)}
                      className="hidden"
                      directory=""
                      webkitdirectory=""
                      multiple
                    />
                    <Button
                      onClick={() => handleFileUpload(files!)}
                      disabled={connectionStatus !== "connected" || !files}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Send Files
                    </Button>
                  </div>
                  {Object.entries(fileTransfers).map(([id, transfer]) => (
                    <div key={id} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="truncate">{transfer.name}</span>
                        <span>{Math.round(transfer.progress)}%</span>
                      </div>
                      <Progress value={transfer.progress} className="w-full" />
                      {transfer.progress === 100 && !autoDownload && (
                        <Button
                          onClick={() => downloadFile(transfer)}
                          size="sm"
                          className="mt-1"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="flex space-x-2 mt-2">
                    <Input
                      type="text"
                      value={currentMessage}
                      onChange={(e) => setCurrentMessage(e.target.value)}
                      placeholder="Type a message..."
                      className="bg-gray-700 text-white flex-grow"
                      onKeyPress={(e) => {
                        if (e.key === "Enter") {
                          sendMessage();
                        }
                      }}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={
                        !selectedConversation ||
                        connectionStatus !== "connected" ||
                        (conversationType === "individual" &&
                          peerConnectionCount > 1)
                      }
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </Button>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="connections" className="space-y-4">
                <div>
                  <p className="mb-2">
                    Your ID:{" "}
                    {peerId || <Loader2 className="inline animate-spin" />}
                  </p>
                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                    <Input
                      type="text"
                      placeholder="Peer ID to connect"
                      value={newPeerId}
                      onChange={(e) => setNewPeerId(e.target.value)}
                      className="bg-gray-700 text-white"
                      maxLength={4}
                    />
                    <Button
                      onClick={() => connectToPeer()}
                      disabled={newPeerId.length !== 4}
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Connect
                    </Button>
                  </div>
                  <div>
                    <p className="mb-2">Status: {connectionStatus}</p>
                  </div>
                  <div className="flex justify-between items-center">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button disabled={isInGroup}>
                          <Users className="w-4 h-4 mr-2" />
                          {isInGroup ? "In Group" : "Create/Join Group"}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>
                            {isInGroup ? "Group Info" : "Create or Join Group"}
                          </DialogTitle>
                          <DialogDescription>
                            {isInGroup
                              ? `You're in group ${activeGroup}. Share this ID with others to let them join.`
                              : "Create a new group or join an existing one by entering the group ID."}
                          </DialogDescription>
                        </DialogHeader>
                        {isInGroup ? (
                          <div className="flex items-center space-x-2">
                            <Input
                              value={activeGroup!}
                              readOnly
                              className="bg-gray-700 text-white"
                            />
                            <Button
                              onClick={() => {
                                navigator.clipboard.writeText(activeGroup!);
                                toast({
                                  title: "Copied",
                                  description: "Group ID copied to clipboard",
                                });
                              }}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <Button onClick={createGroup} className="w-full">
                              Create New Group
                            </Button>
                            <div className="flex space-x-2">
                              <Input
                                placeholder="Enter Group ID"
                                value={newPeerId}
                                onChange={(e) => setNewPeerId(e.target.value)}
                                className="bg-gray-700 text-white"
                              />
                              <Button onClick={() => joinGroup(newPeerId)}>
                                Join
                              </Button>
                            </div>
                          </div>
                        )}
                        <DialogFooter>
                          {isInGroup && (
                            <Button variant="destructive" onClick={leaveGroup}>
                              Leave Group
                            </Button>
                          )}
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div>
                    <p className="mb-2">Connected Peers:</p>
                    <ScrollArea className="h-40 bg-gray-700 rounded-md p-2">
                      {remotePeers.map((peer) => (
                        <div
                          key={peer.id}
                          className={`flex items-center space-x-2 mb-2 p-2 rounded-md cursor-pointer ${
                            selectedConversation === peer.id
                              ? "bg-blue-600"
                              : "bg-gray-600"
                          }`}
                          onClick={() => selectConversation(peer.id)}
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>{peer.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <span>{peer.name}</span>
                        </div>
                      ))}
                    </ScrollArea>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
