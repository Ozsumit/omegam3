import { useState, useRef, useEffect, useCallback } from "react";
import {
  Paperclip,
  Send,
  ArrowLeft,
  MoreVertical,
  Trash2,
  UserX,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  Download,
  Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { UserProfile, Message, FileTransfer, PeerData, FileInfo, FolderToSend } from "@/types";

const getFileIcon = (type: string) => {
  if (type.startsWith("image/")) return <ImageIcon className="h-5 w-5" />;
  if (type.startsWith("video/")) return <Video className="h-5 w-5" />;
  if (type.startsWith("audio/")) return <Music className="h-5 w-5" />;
  if (type.includes("zip") || type.includes("rar")) return <Archive className="h-5 w-5" />;
  return <FileText className="h-5 w-5" />;
};

function MessageBubble({
  message,
  isMe,
  transfer,
  onDownload,
}: {
  message: Message;
  isMe: boolean;
  transfer?: FileTransfer;
  onDownload: (info: FileInfo) => void;
}) {
  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} mb-6 group`}>
      <div className={`relative max-w-[85%] md:max-w-[70%] p-4 rounded-3xl transition-all duration-200 ${
        isMe
          ? "bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-600/20"
          : "glass-dark text-slate-100 rounded-tl-none border-white/5"
      }`}>
        {message.type === "text" ? (
          <p className="text-sm md:text-[15px] leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className="flex flex-col gap-4 min-w-[220px]">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-2xl ${isMe ? "bg-white/10" : "bg-blue-600/20 text-blue-400"}`}>
                {getFileIcon(message.fileInfo!.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{message.fileInfo!.name}</p>
                <p className="text-[11px] opacity-60 font-medium uppercase tracking-wider">
                  {(message.fileInfo!.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>

            {(transfer?.status === 'receiving' || transfer?.status === 'transferring') && (
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest opacity-60">
                  <span>{transfer.status}</span>
                  <span>{Math.round(transfer.progress)}%</span>
                </div>
                <Progress value={transfer.progress} className={`h-1.5 ${isMe ? "bg-white/20 [&>div]:bg-white" : "bg-white/10"}`} />
              </div>
            )}

            {transfer?.status === 'completed' && !isMe && (
              <Button
                size="sm"
                variant={isMe ? "secondary" : "default"}
                className={`w-full h-10 rounded-xl font-bold text-xs uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 ${
                  !isMe ? "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/20" : ""
                }`}
                onClick={() => onDownload(message.fileInfo!)}
              >
                <Download className="h-3.5 w-3.5 mr-2" /> Download
              </Button>
            )}
            {transfer?.status === 'failed' && (
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest text-center">Transfer Failed</p>
            )}
          </div>
        )}
      </div>
      <div className={`flex items-center gap-2 mt-1.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200`}>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {isMe && message.status === 'delivered' && (
          <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Delivered</span>
        )}
      </div>
    </div>
  );
}

export function ChatWindow({
  profile,
  selectedConversationId,
  messages,
  fileTransfers,
  peers,
  onSendMessage,
  onSendFile,
  onZipAndSendFolder,
  onDownloadFile,
  onBack,
  onSendTypingStatus,
  onClearConversationMessages,
  onDeletePeer,
  isPeerTyping,
}: {
  profile: UserProfile;
  selectedConversationId: string | null;
  messages: Message[];
  fileTransfers: Record<string, FileTransfer>;
  peers: Record<string, PeerData>;
  onSendMessage: (c: string) => void;
  onSendFile: (f: File) => void;
  onZipAndSendFolder: (h: any, n: string, f: boolean) => void;
  onDownloadFile: (i: FileInfo) => void;
  onBack: () => void;
  onSendTypingStatus: (t: boolean) => void;
  onClearConversationMessages: (id: string) => void;
  onDeletePeer: (id: string) => void;
  isPeerTyping: boolean;
}) {
  const [input, setInput] = useState("");
  const [folderToSend, setFolderToSend] = useState<FolderToSend | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (input.trim()) {
      onSendMessage(input);
      setInput("");
      onSendTypingStatus(false);
    }
  };

  const handleFolderPick = async () => {
    if ("showDirectoryPicker" in window) {
      try {
        const handle = await (window as any).showDirectoryPicker();
        setFolderToSend({ handle, name: handle.name, isFallback: false });
      } catch (e) {}
    } else {
      folderRef.current?.click();
    }
  };

  if (!selectedConversationId) return null;

  const peer = peers[selectedConversationId];

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      {folderToSend && (
        <Dialog open={true} onOpenChange={() => setFolderToSend(null)}>
          <DialogContent className="bg-slate-900 border-white/5 text-white">
            <DialogHeader>
              <DialogTitle>Send Folder "{folderToSend.name}"</DialogTitle>
              <DialogDescription className="text-slate-400">
                This folder will be compressed into a .zip file before sending.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setFolderToSend(null)}>Cancel</Button>
              <Button onClick={() => {
                onZipAndSendFolder(folderToSend.handle, folderToSend.name, folderToSend.isFallback);
                setFolderToSend(null);
              }}>Zip and Send</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <header className="flex items-center justify-between px-6 py-4 glass border-b border-white/5 z-10">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="md:hidden -ml-2 text-slate-400" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="relative">
            <Avatar className="h-10 w-10 ring-2 ring-blue-500/20">
              <AvatarFallback className="bg-slate-800 text-slate-400">{peer?.name[0]}</AvatarFallback>
            </Avatar>
            {peer?.status === 'online' && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-slate-950 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-sm tracking-tight">{peer?.name}</h3>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${isPeerTyping ? "text-blue-400 animate-pulse" : "text-slate-500"}`}>
              {isPeerTyping ? "Typing..." : peer?.status === 'online' ? 'Online' : 'Offline'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="text-slate-500"><Info className="h-4 w-4" /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-slate-500"><MoreVertical className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-slate-900 border-white/5 text-slate-200 rounded-2xl p-2 min-w-[160px]">
              <DropdownMenuItem onClick={() => onClearConversationMessages(selectedConversationId)} className="rounded-xl focus:bg-white/5">
                <Trash2 className="h-4 w-4 mr-2" /> Clear History
              </DropdownMenuItem>
              <DropdownMenuItem className="text-red-400 rounded-xl focus:bg-red-400/10 focus:text-red-400" onClick={() => onDeletePeer(selectedConversationId)}>
                <UserX className="h-4 w-4 mr-2" /> Delete Peer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <ScrollArea className="flex-1 px-6 pt-6">
        <div className="max-w-4xl mx-auto w-full">
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id || msg.tempId || i}
              message={msg}
              isMe={msg.senderId === profile.id}
              transfer={msg.fileInfo ? fileTransfers[msg.fileInfo.id] : undefined}
              onDownload={onDownloadFile}
            />
          ))}
          <div ref={scrollRef} className="h-6" />
        </div>
      </ScrollArea>

      <footer className="p-6">
        <div className="max-w-4xl mx-auto w-full glass rounded-[2rem] p-2 flex items-center gap-2 shadow-2xl shadow-black/40">
          <Input
            type="file"
            className="hidden"
            ref={fileRef}
            onChange={(e) => e.target.files?.[0] && onSendFile(e.target.files[0])}
          />
          <Input
            type="file"
            className="hidden"
            ref={folderRef}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                const files = Array.from(e.target.files);
                const folderName = files[0].webkitRelativePath.split('/')[0] || "Folder";
                setFolderToSend({ handle: files, name: folderName, isFallback: true });
              }
            }}
            // @ts-ignore
            webkitdirectory=""
            directory=""
            multiple
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full text-slate-400 hover:text-white hover:bg-white/5">
                <Paperclip className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-slate-900 border-white/5 text-white rounded-xl">
              <DropdownMenuItem onClick={() => fileRef.current?.click()}><FileText className="h-4 w-4 mr-2" /> Send File</DropdownMenuItem>
              <DropdownMenuItem onClick={handleFolderPick}><Archive className="h-4 w-4 mr-2" /> Send Folder</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Input
            placeholder="Write a message..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              onSendTypingStatus(e.target.value.length > 0);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            className="bg-transparent border-none focus-visible:ring-0 text-[15px] h-12"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim()}
            className={`h-12 w-12 rounded-full transition-all duration-200 ${
              input.trim() ? "bg-blue-600 hover:bg-blue-500 scale-100" : "bg-slate-800 scale-90 opacity-50"
            }`}
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
