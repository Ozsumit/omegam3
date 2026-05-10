import { useReducer, useCallback, useEffect, useRef } from "react";
import {
  ChatState,
  ChatAction,
  Message,
  PeerData,
  FileInfo,
  FileTransfer,
  PeerMessagePayload,
  UserProfile
} from "@/types";
import { db } from "@/lib/db";
import { useToast } from "@/components/ui/use-toast";
import { useNotifications } from "./useNotifications";
import { usePeer } from "./usePeer";
import JSZip from "jszip";

const CHUNK_SIZE = 16384;

const chatReducer = (state: ChatState, action: ChatAction): ChatState => {
  switch (action.type) {
    case "INIT_STATE": {
      const messagesByConv = action.payload.messages.reduce(
        (acc: Record<string, Message[]>, msg) => {
          if (!acc[msg.conversationId]) acc[msg.conversationId] = [];
          acc[msg.conversationId].push(msg);
          return acc;
        },
        {}
      );
      const peersById = action.payload.peers.reduce(
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
      };
    }
    case "SELECT_CONVERSATION": {
      if (action.payload && state.peers[action.payload]) {
        return {
          ...state,
          selectedConversationId: action.payload,
          peers: {
            ...state.peers,
            [action.payload]: { ...state.peers[action.payload], unreadCount: 0 },
          },
        };
      }
      return { ...state, selectedConversationId: action.payload };
    }
    case "ADD_PEER":
      return {
        ...state,
        peers: { ...state.peers, [action.payload.id]: action.payload },
      };
    case "DELETE_PEER": {
      const newPeers = { ...state.peers };
      delete newPeers[action.payload];
      const newMessages = { ...state.messages };
      delete newMessages[action.payload];
      return {
        ...state,
        peers: newPeers,
        messages: newMessages,
        selectedConversationId:
          state.selectedConversationId === action.payload ? null : state.selectedConversationId,
      };
    }
    case "UPDATE_PEER_STATUS": {
      if (!state.peers[action.payload.peerId]) return state;
      return {
        ...state,
        peers: {
          ...state.peers,
          [action.payload.peerId]: {
            ...state.peers[action.payload.peerId],
            status: action.payload.status,
            lastSeen: action.payload.status === "offline" ? Date.now() : state.peers[action.payload.peerId].lastSeen,
          },
        },
      };
    }
    case "ADD_MESSAGE": {
      const { conversationId } = action.payload;
      const newMessages = [...(state.messages[conversationId] ?? []), action.payload];
      return {
        ...state,
        messages: { ...state.messages, [conversationId]: newMessages },
      };
    }
    case "UPDATE_MESSAGE_STATUS": {
      const { tempId, newId, status, conversationId } = action.payload;
      if (!state.messages[conversationId]) return state;
      const updatedMessages = state.messages[conversationId].map((m) =>
        m.tempId === tempId ? { ...m, status, id: newId, tempId: undefined } : m
      );
      return {
        ...state,
        messages: { ...state.messages, [conversationId]: updatedMessages },
      };
    }
    case "ADD_REACTION": {
      const { conversationId, messageId, reaction, userId } = action.payload;
      if (!state.messages[conversationId]) return state;
      const updatedMessages = state.messages[conversationId].map((m) => {
        if (m.id === messageId) {
          const reactions = { ...(m.reactions || {}) };
          const users = [...(reactions[reaction] || [])];
          if (!users.includes(userId)) {
            users.push(userId);
            reactions[reaction] = users;
          } else {
            reactions[reaction] = users.filter(id => id !== userId);
            if (reactions[reaction].length === 0) delete reactions[reaction];
          }
          return { ...m, reactions };
        }
        return m;
      });
      return { ...state, messages: { ...state.messages, [conversationId]: updatedMessages } };
    }
    case "INCREMENT_UNREAD": {
      if (!state.peers[action.payload] || state.selectedConversationId === action.payload) return state;
      return {
        ...state,
        peers: {
          ...state.peers,
          [action.payload]: {
            ...state.peers[action.payload],
            unreadCount: (state.peers[action.payload].unreadCount ?? 0) + 1,
          },
        },
      };
    }
    case "START_FILE_TRANSFER":
      return {
        ...state,
        fileTransfers: { ...state.fileTransfers, [action.payload.id]: action.payload },
      };
    case "UPDATE_FILE_PROGRESS":
      if (!state.fileTransfers[action.payload.id]) return state;
      return {
        ...state,
        fileTransfers: {
          ...state.fileTransfers,
          [action.payload.id]: { ...state.fileTransfers[action.payload.id], progress: action.payload.progress },
        },
      };
    case "FINISH_FILE_TRANSFER":
      if (!state.fileTransfers[action.payload.id]) return state;
      return {
        ...state,
        fileTransfers: {
          ...state.fileTransfers,
          [action.payload.id]: {
            ...state.fileTransfers[action.payload.id],
            status: action.payload.status,
            progress: action.payload.status === "completed" ? 100 : state.fileTransfers[action.payload.id].progress,
          },
        },
      };
    case "UPDATE_TYPING_STATUS":
      return {
        ...state,
        typingStates: { ...state.typingStates, [action.payload.peerId]: action.payload.isTyping },
      };
    default:
      return state;
  }
};

export function useChatManager(profile: UserProfile | null) {
  const initialState: ChatState = {
    peers: {},
    messages: {},
    fileTransfers: {},
    selectedConversationId: null,
    typingStates: {},
  };
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const { toast } = useToast();
  const { requestPermission, showNotification, playSoundNotification, updateTabTitle } = useNotifications();

  const incomingFiles = useRef<Record<string, { metadata: FileInfo; chunks: ArrayBuffer[]; expectedSeq: number }>>({});
  const outgoingFiles = useRef<Record<string, { file: File; offset: number; seq: number }>>({});

  const sendMessageToPeerRef = useRef<(peerId: string, data: PeerMessagePayload) => boolean>(() => false);

  const sendNextChunk = useCallback((peerId: string, fileId: string) => {
    const outgoing = outgoingFiles.current[fileId];
    if (!outgoing) return;

    if (outgoing.offset >= outgoing.file.size) {
      sendMessageToPeerRef.current(peerId, { type: "file-end", payload: { id: fileId } });
      dispatch({ type: "FINISH_FILE_TRANSFER", payload: { id: fileId, status: "completed" } });
      delete outgoingFiles.current[fileId];
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (!e.target?.result) return;
      const chunk = e.target.result as ArrayBuffer;
      const success = sendMessageToPeerRef.current(peerId, {
        type: "file-chunk",
        payload: { id: fileId, chunk, seq: outgoing.seq }
      });

      if (success) {
        outgoing.offset += chunk.byteLength;
        dispatch({ type: "UPDATE_FILE_PROGRESS", payload: { id: fileId, progress: (outgoing.offset / outgoing.file.size) * 100 } });
      } else {
        dispatch({ type: "FINISH_FILE_TRANSFER", payload: { id: fileId, status: "failed" } });
        delete outgoingFiles.current[fileId];
      }
    };
    reader.readAsArrayBuffer(outgoing.file.slice(outgoing.offset, outgoing.offset + CHUNK_SIZE));
  }, []);

  const handleDataReceived = useCallback(
    async (peerId: string, data: PeerMessagePayload) => {
      if (!profile) return;
      const currentPeers = stateRef.current.peers;
      const peerName = currentPeers[peerId]?.name ?? peerId;

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
          const newMsg: Message = {
            conversationId: peerId,
            senderId: peerId,
            senderName: peerName,
            content: data.payload.content,
            timestamp: Date.now(),
            type: "text",
            status: "delivered",
            replyTo: data.payload.replyTo,
          };
          const id = await db.messages.add(newMsg);
          dispatch({ type: "ADD_MESSAGE", payload: { ...newMsg, id } });
          dispatch({ type: "INCREMENT_UNREAD", payload: peerId });
          showNotification(`New message from ${peerName}`, { body: data.payload.content });
          playSoundNotification();
          updateTabTitle(peerName);
          break;
        }
        case "file-meta": {
          const metadata = data.payload;
          incomingFiles.current[metadata.id] = { metadata, chunks: [], expectedSeq: 0 };
          dispatch({
            type: "START_FILE_TRANSFER",
            payload: { ...metadata, status: "receiving", progress: 0, direction: "incoming" },
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
          dispatch({ type: "ADD_MESSAGE", payload: { ...newFileMsg, id: newId } });
          dispatch({ type: "INCREMENT_UNREAD", payload: peerId });
          showNotification(`Incoming file from ${peerName}`, { body: metadata.name });
          playSoundNotification();
          updateTabTitle(peerName);
          break;
        }
        case "file-chunk": {
          const { id, chunk, seq } = data.payload;
          const transfer = incomingFiles.current[id];
          if (transfer) {
            transfer.chunks.push(chunk);
            const receivedSize = transfer.chunks.reduce((acc, c) => acc + c.byteLength, 0);
            const progress = (receivedSize / transfer.metadata.size) * 100;
            dispatch({ type: "UPDATE_FILE_PROGRESS", payload: { id, progress } });

            sendMessageToPeerRef.current(peerId, { type: "ack", payload: { id, seq: seq || 0 } });
          }
          break;
        }
        case "file-end": {
          const { id } = data.payload;
          const transfer = incomingFiles.current[id];
          if (transfer) {
            const fileBlob = new Blob(transfer.chunks, { type: transfer.metadata.type });
            if (fileBlob.size !== transfer.metadata.size) {
              dispatch({ type: "FINISH_FILE_TRANSFER", payload: { id, status: "failed" } });
            } else {
              await db.files.put({ id, blob: fileBlob });
              dispatch({ type: "FINISH_FILE_TRANSFER", payload: { id, status: "completed" } });
              toast({ title: "File Received", description: transfer.metadata.name });
            }
            delete incomingFiles.current[id];
          }
          break;
        }
        case "ack": {
          const { id, seq } = data.payload;
          const outgoing = outgoingFiles.current[id];
          if (outgoing && outgoing.seq === seq) {
            outgoing.seq++;
            sendNextChunk(peerId, id);
          }
          break;
        }
        case "reaction": {
          const { messageId, reaction, userId } = data.payload;
          dispatch({ type: "ADD_REACTION", payload: { conversationId: peerId, messageId, reaction, userId } });
          const msg = await db.messages.get(messageId);
          if (msg) {
            const reactions = { ...(msg.reactions || {}) };
            const users = [...(reactions[reaction] || [])];
            if (!users.includes(userId)) {
              users.push(userId);
              reactions[reaction] = users;
            } else {
              reactions[reaction] = users.filter(id => id !== userId);
              if (reactions[reaction].length === 0) delete reactions[reaction];
            }
            await db.messages.update(messageId, { reactions });
          }
          break;
        }
        case "typing":
          dispatch({ type: "UPDATE_TYPING_STATUS", payload: { peerId, isTyping: data.payload.isTyping } });
          break;
      }
    },
    [profile, showNotification, playSoundNotification, updateTabTitle, toast, sendNextChunk]
  );

  const handlePeerConnected = useCallback(
    async (peerId: string) => {
      await db.peers.update(peerId, { status: "online" });
      dispatch({ type: "UPDATE_PEER_STATUS", payload: { peerId, status: "online" } });
      toast({ title: "Peer Connected", description: `Connected to a peer` });
      requestPermission();
    },
    [toast, requestPermission]
  );

  const handlePeerDisconnected = useCallback(
    async (peerId: string, hadError?: boolean) => {
      await db.peers.update(peerId, { status: "offline", lastSeen: Date.now() });
      dispatch({ type: "UPDATE_PEER_STATUS", payload: { peerId, status: "offline" } });
      dispatch({ type: "UPDATE_TYPING_STATUS", payload: { peerId, isTyping: false } });
      toast({
        title: hadError ? "Connection Failed" : "Peer Disconnected",
        description: `Lost connection to peer`,
        variant: "destructive",
      });
    },
    [toast]
  );

  const peerHook = usePeer({
    profile,
    onDataReceived: handleDataReceived,
    onPeerConnected: handlePeerConnected,
    onPeerDisconnected: handlePeerDisconnected,
  });

  sendMessageToPeerRef.current = peerHook.sendMessageToPeer;

  useEffect(() => {
    const loadInitialData = async () => {
      const [peers, messages] = await Promise.all([db.peers.toArray(), db.messages.toArray()]);
      peers.forEach((p) => (p.status = "offline"));
      dispatch({ type: "INIT_STATE", payload: { peers, messages } });
    };
    loadInitialData();
  }, []);

  useEffect(() => {
    if (peerHook.isPeerReady) {
      peerHook.reconnectToPastPeers();
    }
  }, [peerHook.isPeerReady, peerHook.reconnectToPastPeers]);

  const selectConversation = (peerId: string | null) => {
    dispatch({ type: "SELECT_CONVERSATION", payload: peerId });
    if (peerId) updateTabTitle(null);
  };

  const sendMessage = async (content: string, replyTo?: Message["replyTo"]) => {
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
      replyTo,
    };
    dispatch({ type: "ADD_MESSAGE", payload: message });
    peerHook.sendMessageToPeer(convId, { type: "typing", payload: { isTyping: false } });

    const success = peerHook.sendMessageToPeer(convId, { type: "text", payload: { content, replyTo } });
    const newStatus = success ? "sent" : "failed";
    const { tempId: _t, ...dbMessage } = message;
    const newId = await db.messages.add({ ...dbMessage, status: newStatus });
    dispatch({ type: "UPDATE_MESSAGE_STATUS", payload: { tempId, newId, status: newStatus, conversationId: convId } });
  };

  const addReaction = async (messageId: number, reaction: string) => {
    if (!profile || !stateRef.current.selectedConversationId) return;
    const convId = stateRef.current.selectedConversationId;

    // Immediate UI Update
    dispatch({ type: "ADD_REACTION", payload: { conversationId: convId, messageId, reaction, userId: profile.id } });

    // Send to peer
    peerHook.sendMessageToPeer(convId, { type: "reaction", payload: { messageId, reaction, userId: profile.id } });

    // Persist
    const msg = await db.messages.get(messageId);
    if (msg) {
      const reactions = { ...(msg.reactions || {}) };
      const users = [...(reactions[reaction] || [])];
      if (!users.includes(profile.id)) {
        users.push(profile.id);
        reactions[reaction] = users;
      } else {
        reactions[reaction] = users.filter(id => id !== profile.id);
        if (reactions[reaction].length === 0) delete reactions[reaction];
      }
      await db.messages.update(messageId, { reactions });
    }
  };

  const sendFile = async (file: File) => {
    if (!profile || !state.selectedConversationId) return;
    const fileId = crypto.randomUUID();
    const peerId = state.selectedConversationId;
    const fileInfo: FileInfo = { id: fileId, name: file.name, size: file.size, type: file.type };

    dispatch({
      type: "START_FILE_TRANSFER",
      payload: { ...fileInfo, status: "transferring", progress: 0, direction: "outgoing" },
    });

    const message: Message = {
      conversationId: peerId,
      senderId: profile.id,
      senderName: profile.name,
      content: `Sending file: ${file.name}`,
      timestamp: Date.now(),
      type: "file-transfer",
      status: "pending",
      fileInfo,
    };
    const newId = await db.messages.add(message);
    dispatch({ type: "ADD_MESSAGE", payload: { ...message, id: newId } });

    const metaSent = peerHook.sendMessageToPeer(peerId, { type: "file-meta", payload: fileInfo });
    if (!metaSent) {
      dispatch({ type: "FINISH_FILE_TRANSFER", payload: { id: fileId, status: "failed" } });
      return;
    }

    outgoingFiles.current[fileId] = { file, offset: 0, seq: 0 };
    sendNextChunk(peerId, fileId);
  };

  const zipAndSendFolder = async (handle: FileSystemDirectoryHandle | FileList | File[], folderName: string, isFallback: boolean) => {
    const zip = new JSZip();
    toast({ title: "Zipping folder...", description: "Please wait while we prepare your folder for transfer." });

    try {
      if (isFallback) {
        for (const file of Array.from(handle as FileList)) {
          const path = (file as any).webkitRelativePath || file.name;
          zip.file(path, file);
        }
      } else {
        const addFolder = async (h: FileSystemDirectoryHandle, folder: JSZip) => {
          for await (const [name, entry] of h.entries()) {
            if (entry.kind === 'file') {
              folder.file(name, await (entry as FileSystemFileHandle).getFile());
            } else {
              await addFolder(entry as FileSystemDirectoryHandle, folder.folder(name)!);
            }
          }
        };
        await addFolder(handle as FileSystemDirectoryHandle, zip.folder(folderName)!);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const file = new File([blob], `${folderName}.zip`, { type: "application/zip" });
      await sendFile(file);
    } catch (e) {
      toast({ title: "Zipping Failed", variant: "destructive" });
    }
  };

  return {
    state,
    connectToPeer: peerHook.connectToPeer,
    addAndConnectToPeer: async (peerId: string) => {
      if (!profile || !peerId || peerId === profile.id) return;
      const existingPeer = await db.peers.get(peerId);
      if (!existingPeer) {
        const newPeer: PeerData = { id: peerId, name: `Peer ${peerId}`, status: "connecting", unreadCount: 0 };
        await db.peers.put(newPeer);
        dispatch({ type: "ADD_PEER", payload: newPeer });
      }
      peerHook.connectToPeer(peerId);
    },
    selectConversation,
    sendMessage,
    sendFile,
    zipAndSendFolder,
    addReaction,
    deletePeer: async (peerId: string) => {
      await db.deletePeerAndHistory(peerId);
      dispatch({ type: "DELETE_PEER", payload: peerId });
    },
    clearConversationMessages: async (peerId: string) => {
      await db.clearConversation(peerId);
      dispatch({ type: "INIT_STATE", payload: {
        peers: Object.values(stateRef.current.peers),
        messages: (await db.messages.toArray())
      }});
    },
    sendTypingStatus: (isTyping: boolean) => {
      if (stateRef.current.selectedConversationId) {
        peerHook.sendMessageToPeer(stateRef.current.selectedConversationId, { type: "typing", payload: { isTyping } });
      }
    },
    downloadFile: async (fileInfo: FileInfo) => {
      const stored = await db.files.get(fileInfo.id);
      if (stored) {
        const url = URL.createObjectURL(stored.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileInfo.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  };
}
