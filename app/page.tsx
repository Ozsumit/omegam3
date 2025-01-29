"use client";

import { useState, useEffect, useRef } from "react";
import Peer from "peerjs";
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
} from "lucide-react";
import { zipFiles, unzipFiles } from "@/lib/zipUtils";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

const generateShortId = () =>
  Math.floor(1000 + Math.random() * 9000).toString();

interface Message {
  sender: string;
  content: string;
  timestamp: number;
}

interface FileTransfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  data: ArrayBuffer[];
}

interface PeerData {
  id: string;
  name: string;
}

export default function Home() {
  const [peerId, setPeerId] = useState<string>("");
  const [remotePeerIds, setRemotePeerIds] = useState<PeerData[]>([]);
  const [newPeerId, setNewPeerId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [isInGroup, setIsInGroup] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] =
    useState<string>("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [fileTransfers, setFileTransfers] = useState<
    Record<string, FileTransfer>
  >({});
  const [autoDownload, setAutoDownload] = useState<boolean>(true);
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);

  const peerRef = useRef<Peer>();
  const connectionsRef = useRef<Record<string, Peer.DataConnection>>({});
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const peer = new Peer(generateShortId());

    peer.on("open", (id) => {
      setPeerId(id);
      setConnectionStatus("ready");
    });

    peer.on("connection", handleNewConnection);

    peer.on("error", (error) => {
      console.error("Peer connection error:", error);
      toast({
        title: "Connection Error",
        description:
          "An error occurred with the peer connection. Please try again.",
        variant: "destructive",
      });
    });

    peerRef.current = peer;

    return () => {
      peer.destroy();
    };
  }, []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatScrollRef, messages]);

  const handleNewConnection = (conn: Peer.DataConnection) => {
    setupConnectionListeners(conn);
    connectionsRef.current[conn.peer] = conn;
    setRemotePeerIds((prev) => [...prev, { id: conn.peer, name: conn.peer }]);
    setConnectionStatus("connected");
  };

  const setupConnectionListeners = (conn: Peer.DataConnection) => {
    conn.on("data", handleIncomingData);

    conn.on("close", () => {
      delete connectionsRef.current[conn.peer];
      setRemotePeerIds((prev) => prev.filter((peer) => peer.id !== conn.peer));
      if (Object.keys(connectionsRef.current).length === 0) {
        setConnectionStatus("ready");
      }
    });

    conn.on("error", (error) => {
      console.error("Connection error:", error);
      toast({
        title: "Connection Error",
        description: `An error occurred with the connection to ${conn.peer}. Please try reconnecting.`,
        variant: "destructive",
      });
    });
  };

  const handleIncomingData = async (data: any) => {
    if (typeof data === "string") {
      const message: Message = JSON.parse(data);
      setMessages((prev) => [...prev, message]);
    } else if (data instanceof ArrayBuffer) {
      handleIncomingFileChunk(data);
    } else if (typeof data === "object") {
      if (data.type === "file-info") {
        setFileTransfers((prev) => ({
          ...prev,
          [data.id]: {
            id: data.id,
            name: data.name,
            size: data.size,
            progress: 0,
            data: [],
          },
        }));
      } else if (data.type === "file-chunk") {
        updateFileTransferProgress(data.id, data.progress);
      }
    }
  };

  const handleIncomingFileChunk = (chunk: ArrayBuffer) => {
    setFileTransfers((prev) => {
      const transferId = Object.keys(prev).find(
        (id) => prev[id].progress < 100
      );
      if (!transferId) return prev;

      const updatedTransfer = {
        ...prev[transferId],
        data: [...prev[transferId].data, chunk],
        progress:
          ((prev[transferId].data.length + 1) /
            Math.ceil(prev[transferId].size / 16384)) *
          100,
      };

      if (updatedTransfer.progress >= 100 && autoDownload) {
        downloadFile(updatedTransfer);
      }

      return { ...prev, [transferId]: updatedTransfer };
    });
  };

  const updateFileTransferProgress = (id: string, progress: number) => {
    setFileTransfers((prev) => ({
      ...prev,
      [id]: { ...prev[id], progress },
    }));
  };

  const createGroup = () => {
    const newGroupId = generateShortId();
    setGroupId(newGroupId);
    setIsInGroup(true);
    toast({
      title: "Group Created",
      description: `Your group ID is ${newGroupId}. Share this with others to let them join.`,
    });
  };

  const joinGroup = (id: string) => {
    if (!peerRef.current) return;
    setGroupId(id);
    setIsInGroup(true);
    connectToPeer(id);
    toast({
      title: "Joined Group",
      description: `You've joined group ${id}.`,
    });
  };

  const leaveGroup = () => {
    Object.values(connectionsRef.current).forEach((conn) => conn.close());
    setRemotePeerIds([]);
    setGroupId("");
    setIsInGroup(false);
    setConnectionStatus("ready");
    toast({
      title: "Left Group",
      description: "You've left the group.",
    });
  };

  const connectToPeer = (id: string = newPeerId) => {
    if (!peerRef.current || !id) return;
    const conn = peerRef.current.connect(id);
    conn.on("open", () => {
      setupConnectionListeners(conn);
      connectionsRef.current[id] = conn;
      setRemotePeerIds((prev) => [...prev, { id, name: id }]);
      setNewPeerId("");
      setConnectionStatus("connected");
      toast({
        title: "Connected",
        description: `Successfully connected to peer ${id}.`,
      });
    });
  };

  const sendMessage = () => {
    if (Object.keys(connectionsRef.current).length === 0 || !currentMessage)
      return;
    const message: Message = {
      sender: peerId,
      content: currentMessage,
      timestamp: Date.now(),
    };
    Object.values(connectionsRef.current).forEach((conn) =>
      conn.send(JSON.stringify(message))
    );
    setMessages((prev) => [...prev, message]);
    setCurrentMessage("");
  };

  const sendFiles = async () => {
    if (Object.keys(connectionsRef.current).length === 0 || !files) return;

    let dataToSend: Blob;
    let fileName: string;

    if (files.length > 1 || files[0].webkitRelativePath) {
      dataToSend = await zipFiles(Array.from(files));
      fileName = "transfer.zip";
    } else {
      dataToSend = files[0];
      fileName = files[0].name;
    }

    const fileId = Date.now().toString();
    const fileInfo = {
      type: "file-info",
      id: fileId,
      name: fileName,
      size: dataToSend.size,
    };
    Object.values(connectionsRef.current).forEach((conn) =>
      conn.send(fileInfo)
    );

    const chunkSize = 16384;
    const totalChunks = Math.ceil(dataToSend.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = dataToSend.slice(i * chunkSize, (i + 1) * chunkSize);
      const chunkBuffer = await chunk.arrayBuffer();
      const progress = Math.round(((i + 1) / totalChunks) * 100);

      Object.values(connectionsRef.current).forEach((conn) => {
        conn.send(chunkBuffer);
        conn.send({ type: "file-chunk", id: fileId, progress });
      });

      setFileTransfers((prev) => ({
        ...prev,
        [fileId]: {
          id: fileId,
          name: fileName,
          size: dataToSend.size,
          progress,
          data: [],
        },
      }));
    }

    setFiles(null);
  };

  const downloadFile = (transfer: FileTransfer) => {
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
  };

  const selectPeer = (peerId: string) => {
    setSelectedPeer(peerId);
    setMessages([]); // Clear messages when switching peers
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 flex flex-col md:flex-row">
      <div className="w-full md:w-1/4 p-4 bg-gray-800 rounded-md mb-4 md:mb-0">
        <h2 className="text-xl font-bold mb-4">Saved Peers</h2>
        <ScrollArea className="h-full bg-gray-700 rounded-md p-2">
          {remotePeerIds.map((peer) => (
            <div
              key={peer.id}
              className={`flex items-center space-x-2 mb-2 p-2 rounded-md cursor-pointer ${
                selectedPeer === peer.id ? "bg-blue-600" : "bg-gray-600"
              }`}
              onClick={() => selectPeer(peer.id)}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback>{peer.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span>{peer.name}</span>
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
                    {messages.map((msg, index) => (
                      <div
                        key={index}
                        className={`mb-2 ${
                          msg.sender === peerId ? "text-right" : "text-left"
                        }`}
                      >
                        <div
                          className={`inline-block p-2 rounded-md ${
                            msg.sender === peerId
                              ? "bg-blue-600"
                              : "bg-gray-600"
                          }`}
                        >
                          <p className="text-sm text-gray-300">{msg.sender}</p>
                          <p>{msg.content}</p>
                          <p className="text-xs text-gray-400">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                  <div className="flex space-x-2">
                    <Input
                      type="text"
                      placeholder="Type a message"
                      value={currentMessage}
                      onChange={(e) => setCurrentMessage(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                      className="bg-gray-700 text-white"
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={connectionStatus !== "connected"}
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
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
                      webkitdirectory="true"
                      directory="true"
                      multiple
                    />
                    <Button
                      onClick={sendFiles}
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
                      disabled={
                        connectionStatus !== "ready" || newPeerId.length !== 4
                      }
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Connect
                    </Button>
                  </div>
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
                            ? `You're in group ${groupId}. Share this ID with others to let them join.`
                            : "Create a new group or join an existing one by entering the group ID."}
                        </DialogDescription>
                      </DialogHeader>
                      {isInGroup ? (
                        <div className="flex items-center space-x-2">
                          <Input
                            value={groupId}
                            readOnly
                            className="bg-gray-700 text-white"
                          />
                          <Button
                            onClick={() => {
                              navigator.clipboard.writeText(groupId);
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
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-download"
                      checked={autoDownload}
                      onCheckedChange={setAutoDownload}
                    />
                    <Label htmlFor="auto-download">Auto-download files</Label>
                  </div>
                </div>
                <div>
                  <p className="mb-2">Connected Peers:</p>
                  <ScrollArea className="h-40 bg-gray-700 rounded-md p-2">
                    {remotePeerIds.map((peer) => (
                      <div
                        key={peer.id}
                        className={`flex items-center space-x-2 mb-2 p-2 rounded-md cursor-pointer ${
                          selectedPeer === peer.id
                            ? "bg-blue-600"
                            : "bg-gray-600"
                        }`}
                        onClick={() => selectPeer(peer.id)}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>{peer.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span>{peer.name}</span>
                      </div>
                    ))}
                  </ScrollArea>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
