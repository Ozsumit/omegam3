import { useState, useRef, useEffect } from "react";
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
  SmilePlus,
  Zap,
  Reply,
  X,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserProfile, Message, FileTransfer, PeerData, FileInfo, FolderToSend } from "@/types";
import { db } from "@/lib/db";

const getFileIcon = (type: string) => {
  if (type.startsWith("image/")) return <ImageIcon className="h-6 w-6" />;
  if (type.startsWith("video/")) return <Video className="h-6 w-6" />;
  if (type.startsWith("audio/")) return <Music className="h-6 w-6" />;
  if (type.includes("zip") || type.includes("rar")) return <Archive className="h-6 w-6" />;
  return <FileText className="h-6 w-6" />;
};

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function MessageBubble({
  message,
  isMe,
  transfer,
  onDownload,
  onReact,
  onReply,
}: {
  message: Message;
  isMe: boolean;
  transfer?: FileTransfer;
  onDownload: (info: FileInfo) => void;
  onReact: (id: number, r: string) => void;
  onReply: (m: Message) => void;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    if (message.type === 'file-transfer' && message.fileInfo?.type.startsWith('image/') && message.status === 'delivered') {
      db.files.get(message.fileInfo.id).then(stored => {
        if (stored) setImgUrl(URL.createObjectURL(stored.blob));
      });
    }
    return () => { if (imgUrl) URL.revokeObjectURL(imgUrl); };
  }, [message.status]);

  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} mb-8 group animate-message w-full`}>
      <div className={`flex items-center gap-2 max-w-[90%] md:max-w-[75%] ${isMe ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`relative p-6 rounded-[2.5rem] transition-all duration-300 ${
          isMe
            ? "bg-primary text-white rounded-tr-none shadow-swiss"
            : "bg-secondary text-foreground rounded-tl-none border shadow-sm"
        }`}>
          {message.replyTo && (
            <div className={`mb-4 p-3 rounded-2xl text-[11px] font-bold border-l-4 ${isMe ? "bg-white/10 border-white/40" : "bg-black/5 border-primary"}`}>
              <p className="opacity-50 mb-1 uppercase tracking-widest">{message.replyTo.senderName}</p>
              <p className="line-clamp-2 leading-relaxed">{message.replyTo.content}</p>
            </div>
          )}

          {message.type === "text" ? (
            <p className="text-base md:text-lg font-medium leading-relaxed whitespace-pre-wrap break-words tracking-tight">{message.content}</p>
          ) : (
            <div className="flex flex-col gap-6 min-w-[240px]">
              {imgUrl ? (
                <div className="rounded-3xl overflow-hidden shadow-swiss border-4 border-background bg-muted">
                  <img src={imgUrl} alt={message.fileInfo?.name} className="w-full h-auto max-h-[400px] object-contain" />
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-3xl ${isMe ? "bg-white/20" : "bg-primary/10 text-primary"}`}>
                    {getFileIcon(message.fileInfo!.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-bold truncate tracking-tight">{message.fileInfo!.name}</p>
                    <p className={`text-[10px] font-black uppercase tracking-widest opacity-40`}>
                      {(message.fileInfo!.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
              )}

              {(transfer?.status === 'receiving' || transfer?.status === 'transferring') && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-[0.2em] opacity-40">
                    <span>{transfer.status}</span>
                    <span>{Math.round(transfer.progress)}%</span>
                  </div>
                  <Progress value={transfer.progress} className={`h-1.5 ${isMe ? "bg-white/20 [&>div]:bg-white" : "bg-primary/10"}`} />
                </div>
              )}

              {transfer?.status === 'completed' && !isMe && (
                <Button
                  onClick={() => onDownload(message.fileInfo!)}
                  className="w-full h-12 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] bg-primary text-white hover:opacity-90 shadow-sm"
                >
                  <Download className="h-4 w-4 mr-2" /> Download
                </Button>
              )}
            </div>
          )}

          {message.reactions && Object.keys(message.reactions).length > 0 && (
            <div className={`absolute -bottom-4 flex gap-1 ${isMe ? "right-6" : "left-6"}`}>
              {Object.entries(message.reactions).map(([emoji, users]) => (
                <button
                  key={emoji}
                  onClick={() => onReact(message.id!, emoji)}
                  className="bg-background border-2 shadow-swiss px-2.5 py-1 rounded-full text-sm font-bold flex items-center gap-1.5 hover:scale-110 transition-all active:scale-90"
                >
                  <span>{emoji}</span>
                  <span className="text-[10px] opacity-40 font-black">{users.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200`}>
          <ReactionPicker onSelect={(r) => onReact(message.id!, r)} />
          <button onClick={() => onReply(message)} className="h-10 w-10 flex items-center justify-center bg-secondary rounded-full hover:bg-muted transition-colors shadow-sm">
            <Reply className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className={`flex items-center gap-3 mt-3 px-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300`}>
        <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {isMe && message.status === 'delivered' && (
          <span className="text-[9px] font-black text-primary uppercase tracking-widest">Seen</span>
        )}
      </div>
    </div>
  );
}

function ReactionPicker({ onSelect }: { onSelect: (r: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="h-10 w-10 flex items-center justify-center bg-secondary rounded-full hover:bg-muted transition-colors shadow-sm">
          <SmilePlus className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="rounded-full p-1.5 border-none shadow-swiss w-fit flex gap-1 animate-in zoom-in-50 duration-200">
        {REACTIONS.map(r => (
          <button
            key={r}
            onClick={() => onSelect(r)}
            className="h-10 w-10 flex items-center justify-center text-lg hover:scale-125 transition-transform active:scale-90"
          >
            {r}
          </button>
        ))}
      </PopoverContent>
    </Popover>
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
  onAddReaction,
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
  onSendMessage: (c: string, r?: Message["replyTo"]) => void;
  onSendFile: (f: File) => void;
  onZipAndSendFolder: (h: any, n: string, f: boolean) => void;
  onDownloadFile: (i: FileInfo) => void;
  onAddReaction: (id: number, r: string) => void;
  onBack: () => void;
  onSendTypingStatus: (t: boolean) => void;
  onClearConversationMessages: (id: string) => void;
  onDeletePeer: (id: string) => void;
  isPeerTyping: boolean;
}) {
  const [input, setInput] = useState("");
  const [folderToSend, setFolderToSend] = useState<FolderToSend | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (input.trim()) {
      onSendMessage(input, replyTo ? { id: replyTo.id!, senderName: replyTo.senderName, content: replyTo.content } : undefined);
      setInput("");
      setReplyTo(null);
      onSendTypingStatus(false);
    }
  };

  if (!selectedConversationId) return (
    <div className="flex-1 flex items-center justify-center bg-secondary/20">
      <div className="text-center px-8">
        <div className="h-32 w-32 bg-primary rounded-[3rem] mx-auto mb-8 flex items-center justify-center shadow-swiss animate-pulse">
          <Zap className="h-16 w-16 text-white" />
        </div>
        <h2 className="text-4xl font-black tracking-tighter uppercase italic leading-tight">Swiss Standard<br/>P2P Protocol</h2>
        <p className="text-muted-foreground font-bold uppercase tracking-widest text-[10px] mt-4 opacity-40">Secure End-to-End Encrypted Link</p>
      </div>
    </div>
  );

  const peer = peers[selectedConversationId];

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {folderToSend && (
        <Dialog open={true} onOpenChange={() => setFolderToSend(null)}>
          <DialogContent className="rounded-[3rem] p-10 border-none shadow-swiss">
            <DialogHeader>
              <DialogTitle className="text-3xl font-black tracking-tighter uppercase leading-none">Pack Folder</DialogTitle>
              <DialogDescription className="text-lg font-medium text-muted-foreground mt-2">
                "{folderToSend.name}" will be processed for secure transfer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-10 gap-3">
              <Button variant="secondary" className="h-16 px-8 rounded-2xl font-bold text-base" onClick={() => setFolderToSend(null)}>Cancel</Button>
              <Button className="h-16 px-8 rounded-2xl font-bold text-base bg-primary text-white shadow-swiss" onClick={() => {
                onZipAndSendFolder(folderToSend.handle, folderToSend.name, folderToSend.isFallback);
                setFolderToSend(null);
              }}>Start Transfer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <header className="flex items-center justify-between px-6 md:px-10 py-6 md:py-8 border-b bg-background/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-4 md:gap-6">
          <Button variant="ghost" size="icon" className="md:hidden -ml-4" onClick={onBack}>
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div className="relative shrink-0">
            <Avatar className="h-12 w-12 md:h-16 md:w-16 border-4 border-background shadow-swiss">
              <AvatarFallback className="bg-primary text-white font-black text-xl">{peer?.name[0]}</AvatarFallback>
            </Avatar>
            {peer?.status === 'online' && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-background shadow-sm" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-xl md:text-2xl font-black tracking-tight truncate leading-tight">{peer?.name}</h3>
            <p className={`text-[9px] font-black uppercase tracking-[0.2em] ${isPeerTyping ? "text-primary animate-pulse" : "opacity-40"}`}>
              {isPeerTyping ? "Transmitting..." : peer?.status === 'online' ? 'Link Active' : 'Offline'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" className="h-10 w-10 md:h-12 md:w-12 rounded-2xl shadow-sm"><Info className="h-5 w-5 opacity-50" /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="h-10 w-10 md:h-12 md:w-12 rounded-2xl shadow-sm"><MoreVertical className="h-5 w-5 opacity-50" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-[2rem] p-3 border-none shadow-swiss min-w-[220px]">
              <DropdownMenuItem onClick={() => onClearConversationMessages(selectedConversationId)} className="rounded-2xl h-14 font-bold text-sm">
                <Trash2 className="h-5 w-5 mr-4 opacity-50" /> Clear History
              </DropdownMenuItem>
              <DropdownMenuItem className="text-primary rounded-2xl h-14 font-bold text-sm" onClick={() => onDeletePeer(selectedConversationId)}>
                <UserX className="h-5 w-5 mr-4 opacity-50" /> Delete Peer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto w-full px-6 md:px-10 py-10">
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id || msg.tempId || i}
              message={msg}
              isMe={msg.senderId === profile.id}
              transfer={msg.fileInfo ? fileTransfers[msg.fileInfo.id] : undefined}
              onDownload={onDownloadFile}
              onReact={onAddReaction}
              onReply={setReplyTo}
            />
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <footer className="px-6 md:px-10 pb-10 pt-4">
        <div className="max-w-4xl mx-auto w-full flex flex-col gap-3">
          {replyTo && (
            <div className="flex items-center justify-between bg-secondary/80 backdrop-blur px-6 py-4 rounded-[2rem] animate-in slide-in-from-bottom-4 duration-300 border shadow-sm">
              <div className="flex items-center gap-4 min-w-0">
                <Reply className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Replying to {replyTo.senderName}</p>
                  <p className="text-sm font-bold truncate leading-relaxed">{replyTo.content}</p>
                </div>
              </div>
              <button onClick={() => setReplyTo(null)} className="h-10 w-10 shrink-0 flex items-center justify-center hover:bg-black/5 rounded-full transition-colors">
                <X className="h-5 w-5 opacity-40" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-3 bg-secondary rounded-[3.5rem] p-2.5 shadow-swiss border border-white/5">
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
                <Button variant="ghost" size="icon" className="h-14 w-14 rounded-full hover:bg-background transition-colors shrink-0">
                  <Paperclip className="h-6 w-6 opacity-40" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="rounded-[2.5rem] p-3 border-none shadow-swiss min-w-[200px]">
                <DropdownMenuItem onClick={() => fileRef.current?.click()} className="rounded-2xl h-14 font-bold">
                  <FileText className="h-5 w-5 mr-4 opacity-40" /> Send File
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  if ("showDirectoryPicker" in window) {
                    (window as any).showDirectoryPicker().then((handle: any) => {
                      setFolderToSend({ handle, name: handle.name, isFallback: false });
                    });
                  } else {
                    folderRef.current?.click();
                  }
                }} className="rounded-2xl h-14 font-bold">
                  <Archive className="h-5 w-5 mr-4 opacity-40" /> Send Folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Input
              placeholder="Type message..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                onSendTypingStatus(e.target.value.length > 0);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              className="bg-transparent border-none focus-visible:ring-0 text-lg md:text-xl font-medium h-14 px-2"
            />

            <Button variant="ghost" size="icon" className="h-14 w-14 rounded-full hover:bg-background transition-colors shrink-0">
              <SmilePlus className="h-6 w-6 opacity-40" />
            </Button>

            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              className={`h-14 w-14 rounded-full transition-all duration-300 shadow-swiss shrink-0 ${
                input.trim() ? "bg-primary text-white scale-100 hover:scale-105" : "bg-muted-foreground/10 scale-90 opacity-30"
              }`}
            >
              <Send className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
