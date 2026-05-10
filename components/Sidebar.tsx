import { useState } from "react";
import { Copy, UserPlus, Zap, Search, Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { PeerData, UserProfile } from "@/types";

export function Sidebar({
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
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const copyId = () => {
    navigator.clipboard.writeText(profile.id);
    toast({ title: "ID Copied", description: "Your peer ID is in your clipboard." });
  };

  const filteredPeers = peers.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.id.includes(search)
  );

  return (
    <aside className="flex flex-col w-full h-full bg-background border-r">
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-black tracking-tighter uppercase italic text-primary">Omega</h1>
          <button onClick={copyId} className="h-10 w-10 flex items-center justify-center bg-secondary rounded-full hover:bg-muted transition-colors">
            <Settings className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-secondary border-none pl-12 h-14 text-lg font-medium rounded-2xl"
            />
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Peer ID"
              value={newPeerId}
              onChange={(e) => setNewPeerId(e.target.value)}
              className="bg-secondary border-none h-14 text-lg font-medium rounded-2xl"
            />
            <Button onClick={() => { onAddPeer(newPeerId); setNewPeerId(""); }} className="h-14 w-14 rounded-2xl">
              <Plus className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </div>

      <div className="px-8 py-2">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest opacity-40">Messages</h3>
          <button onClick={() => peers.forEach(p => p.status === 'offline' && onConnectToPeer(p.id))} className="text-xs font-bold text-primary hover:underline">
            Connect All
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 space-y-2 pb-8">
          {filteredPeers.map((peer) => (
            <button
              key={peer.id}
              onClick={() => onSelectConversation(peer.id)}
              className={`w-full flex items-center gap-4 p-4 rounded-3xl transition-all duration-200 ${
                selectedConversationId === peer.id
                  ? "bg-primary text-primary-foreground shadow-swiss"
                  : "hover:bg-secondary"
              }`}
            >
              <div className="relative">
                <Avatar className="h-14 w-14 border-4 border-background">
                  <AvatarFallback className={selectedConversationId === peer.id ? "bg-white/20 text-white" : "bg-primary text-white"}>
                    {peer.name[0]}
                  </AvatarFallback>
                </Avatar>
                <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-background ${
                  peer.status === 'online' ? 'bg-green-500' : 'bg-muted-foreground'
                }`} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-bold text-lg truncate tracking-tight">{peer.name}</p>
                <p className={`text-sm font-medium truncate ${selectedConversationId === peer.id ? "opacity-70" : "text-muted-foreground"}`}>
                  {peer.status === 'online' ? 'Online' : 'Offline'}
                </p>
              </div>
              {peer.unreadCount > 0 && (
                <span className={`h-6 min-w-[24px] px-2 flex items-center justify-center rounded-full text-[10px] font-black ${
                  selectedConversationId === peer.id ? "bg-white text-primary" : "bg-primary text-white"
                }`}>
                  {peer.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
