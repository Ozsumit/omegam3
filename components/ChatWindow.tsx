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
  SmilePlus,
  Zap,
  Reply,
  X
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
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} mb-8 group animate-message`}>
      <div className="relative flex items-center gap-2">
        {!isMe && (
          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <ReactionPicker onSelect={(r) => onReact(message.id!, r)} />
            <button onClick={() => onReply(message)} className="h-10 w-10 flex items-center justify-center bg-secondary rounded-full hover:bg-muted transition-colors shadow-swiss">
              <Reply className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        )}
        <div className={`relative max-w-[80vw] md:max-w-[50vw] p-6 rounded-[2.5rem] transition-all duration-300 ${
          isMe
            ? "bg-primary text-white rounded-tr-none shadow-swiss"
            : "bg-secondary text-foreground rounded-tl-none border shadow-sm"
        }`}>
          {message.replyTo && (
            <div className={`mb-4 p-3 rounded-2xl text-xs font-bold border-l-4 ${isMe ? "bg-white/10 border-white/40" : "bg-black/5 border-primary"}`}>
              <p className="opacity-60 mb-1">{message.replyTo.senderName}</p>
              <p className="line-clamp-2">{message.replyTo.content}</p>
            </div>
          )}

          {message.type === "text" ? (
            <p className="text-lg font-medium leading-normal whitespace-pre-wrap break-words tracking-tight">{message.content}</p>
          ) : (
            <div className="flex flex-col gap-6 min-w-[240px]">
              {imgUrl ? (
                <div className="rounded-3xl overflow-hidden shadow-swiss border-4 border-background">
                  <img src={imgUrl} alt={message.fileInfo?.name} className="w-full h-auto max-h-80 object-cover" />
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-3xl ${isMe ? "bg-white/20" : "bg-primary/10 text-primary"}`}>
                    {getFileIcon(message.fileInfo!.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-bold truncate tracking-tight">{message.fileInfo!.name}</p>
                    <p className={`text-xs font-bold uppercase tracking-widest opacity-60`}>
                      {(message.fileInfo!.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
              )}

              {(transfer?.status === 'receiving' || transfer?.status === 'transferring') && (
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] opacity-40">
                    <span>{transfer.status}</span>
                    <span>{Math.round(transfer.progress)}%</span>
                  </div>
                  <Progress value={transfer.progress} className={`h-2 ${isMe ? "bg-white/20 [&>div]:bg-white" : "bg-primary/10"}`} />
                </div>
              )}

              {transfer?.status === 'completed' && !isMe && (
                <Button
                  onClick={() => onDownload(message.fileInfo!)}
                  className="w-full h-14 rounded-2xl font-black text-xs uppercase tracking-widest bg-primary text-white hover:bg-primary/90"
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
                  className="bg-background border shadow-swiss px-2 py-1 rounded-full text-sm font-bold flex items-center gap-1 hover:scale-110 transition-transform active:scale-95"
                >
                  <span>{emoji}</span>
                  <span className="text-[10px] opacity-60">{users.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {isMe && (
          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <ReactionPicker onSelect={(r) => onReact(message.id!, r)} />
            <button onClick={() => onReply(message)} className="h-10 w-10 flex items-center justify-center bg-secondary rounded-full hover:bg-muted transition-colors shadow-swiss">
              <Reply className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>

      <div className={`flex items-center gap-3 mt-3 px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300`}>
        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {isMe && message.status === 'delivered' && (
          <span className="text-[10px] font-black text-primary uppercase tracking-widest">Seen</span>
        )}
      </div>
    </div>
  );
}

function ReactionPicker({ onSelect }: { onSelect: (r: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="h-10 w-10 flex items-center justify-center bg-secondary rounded-full hover:bg-muted transition-colors shadow-swiss">
          <SmilePlus className="h-5 w-5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="rounded-full p-2 border-none shadow-swiss w-fit flex gap-1 animate-in zoom-in-50 duration-200">
        {REACTIONS.map(r => (
          <button
            key={r}
            onClick={() => onSelect(r)}
            className="h-10 w-10 flex items-center justify-center text-xl hover:scale-125 transition-transform active:scale-90"
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
    <div className="flex-1 flex items-center justify-center bg-secondary/30">
      <div className="text-center">
        <div className="h-32 w-32 bg-primary rounded-[3rem] mx-auto mb-8 flex items-center justify-center shadow-swiss">
          <Zap className="h-16 w-16 text-white" />
        </div>
        <h2 className="text-4xl font-black tracking-tighter uppercase italic">Swiss Quality Chat</h2>
        <p className="text-muted-foreground font-medium mt-2">Select a peer to start a high-performance link</p>
      </div>
    </div>
  );

  const peer = peers[selectedConversationId];

  return (
    <div className="flex flex-col h-full bg-background relative">
      {folderToSend && (
        <Dialog open={true} onOpenChange={() => setFolderToSend(null)}>
          <DialogContent className="rounded-[2.5rem] p-10 border-none shadow-swiss">
            <DialogHeader>
              <DialogTitle className="text-3xl font-black tracking-tighter uppercase">Send Folder</DialogTitle>
              <DialogDescription className="text-lg font-medium text-muted-foreground">
                "{folderToSend.name}" will be packed into a high-compression Swiss archive.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-8 gap-4">
              <Button variant="secondary" className="h-14 px-8 rounded-2xl font-bold" onClick={() => setFolderToSend(null)}>Cancel</Button>
              <Button className="h-14 px-8 rounded-2xl font-bold bg-primary text-white shadow-swiss" onClick={() => {
                onZipAndSendFolder(folderToSend.handle, folderToSend.name, folderToSend.isFallback);
                setFolderToSend(null);
              }}>Compress and Send</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <header className="flex items-center justify-between px-10 py-8 border-b">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" className="md:hidden -ml-4" onClick={onBack}>
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div className="relative">
            <Avatar className="h-16 w-16 border-4 border-background shadow-swiss">
              <AvatarFallback className="bg-primary text-white font-black text-xl">{peer?.name[0]}</AvatarFallback>
            </Avatar>
            {peer?.status === 'online' && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-background" />
            )}
          </div>
          <div>
            <h3 className="text-2xl font-black tracking-tight">{peer?.name}</h3>
            <p className={`text-xs font-black uppercase tracking-[0.2em] ${isPeerTyping ? "text-primary animate-pulse" : "text-muted-foreground"}`}>
              {isPeerTyping ? "Link active: Typing..." : peer?.status === 'online' ? 'Active Link' : 'Offline'}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" className="h-12 w-12 rounded-2xl"><MoreVertical className="h-6 w-6" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-3xl p-3 border-none shadow-swiss min-w-[200px] animate-in slide-in-from-top-2 duration-200">
            <DropdownMenuItem onClick={() => onClearConversationMessages(selectedConversationId)} className="rounded-2xl h-12 font-bold">
              <Trash2 className="h-5 w-5 mr-3" /> Clear History
            </DropdownMenuItem>
            <DropdownMenuItem className="text-primary rounded-2xl h-12 font-bold" onClick={() => onDeletePeer(selectedConversationId)}>
              <UserX className="h-5 w-5 mr-3" /> Delete Peer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ScrollArea className="flex-1 px-10 pt-10">
        <div className="max-w-5xl mx-auto w-full pb-10">
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

      <footer className="p-10">
        <div className="max-w-5xl mx-auto w-full flex flex-col gap-4">
          {replyTo && (
            <div className="flex items-center justify-between bg-secondary px-8 py-4 rounded-3xl animate-in slide-in-from-bottom-4 duration-300 shadow-sm border">
              <div className="flex items-center gap-4">
                <Reply className="h-5 w-5 text-primary" />
                <div className="text-sm font-bold">
                  <span className="opacity-40 mr-2 uppercase tracking-widest text-[10px]">Replying to</span>
                  <span className="text-lg tracking-tight">{replyTo.senderName}</span>
                </div>
              </div>
              <button onClick={() => setReplyTo(null)} className="h-10 w-10 flex items-center justify-center hover:bg-black/5 rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-4 bg-secondary rounded-[3rem] p-3 shadow-swiss border">
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
                <Button variant="ghost" size="icon" className="h-16 w-16 rounded-[2rem] hover:bg-background transition-colors">
                  <Paperclip className="h-7 w-7 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="rounded-3xl p-3 border-none shadow-swiss min-w-[200px] animate-in slide-in-from-bottom-2 duration-200">
                <DropdownMenuItem onClick={() => fileRef.current?.click()} className="rounded-2xl h-12 font-bold">
                  <FileText className="h-5 w-5 mr-3" /> File
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  if ("showDirectoryPicker" in window) {
                    (window as any).showDirectoryPicker().then((handle: any) => {
                      setFolderToSend({ handle, name: handle.name, isFallback: false });
                    });
                  } else {
                    folderRef.current?.click();
                  }
                }} className="rounded-2xl h-12 font-bold">
                  <Archive className="h-5 w-5 mr-3" /> Folder
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
              className="bg-transparent border-none focus-visible:ring-0 text-xl font-medium h-16 px-4"
            />

            <Button variant="ghost" size="icon" className="h-16 w-16 rounded-[2rem] hover:bg-background transition-colors">
              <SmilePlus className="h-7 w-7 text-muted-foreground" />
            </Button>

            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              className={`h-16 w-16 rounded-[2rem] transition-all duration-300 shadow-swiss ${
                input.trim() ? "bg-primary text-white scale-100 hover:scale-105 active:scale-95" : "bg-muted-foreground/20 scale-95 opacity-50"
              }`}
            >
              <Send className="h-7 w-7" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
