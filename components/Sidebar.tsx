import { useState } from "react";
import { Copy, UserPlus, Search, Settings, Plus, Check } from "lucide-react";
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
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copyId = () => {
    navigator.clipboard.writeText(profile.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "ID Copied", description: "Your 4-digit ID is ready to share." });
  };

  const filteredPeers = peers.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.id.includes(search)
  );

  return (
    <aside className="flex flex-col w-full h-full bg-background border-r">
      <div className="p-6 md:p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tighter uppercase italic text-primary leading-none">Omega</h1>
            <button
              onClick={copyId}
              className="mt-2 group flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-full hover:bg-muted transition-all"
            >
              <span className="text-[10px] font-black uppercase tracking-widest opacity-50">My ID:</span>
              <span className="text-sm font-bold tracking-tight">{profile.id}</span>
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
            </button>
          </div>
          <button className="h-12 w-12 flex items-center justify-center bg-secondary rounded-2xl hover:bg-muted transition-colors shadow-sm">
            <Settings className="h-5 w-5 opacity-70" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-secondary border-none pl-12 h-14 text-base font-bold rounded-2xl focus-visible:ring-primary/20"
            />
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Connect to ID..."
              value={newPeerId}
              onChange={(e) => setNewPeerId(e.target.value)}
              className="bg-secondary border-none h-14 text-base font-bold rounded-2xl focus-visible:ring-primary/20"
              maxLength={4}
            />
            <Button
              onClick={() => { if(newPeerId.length === 4) { onAddPeer(newPeerId); setNewPeerId(""); } }}
              disabled={newPeerId.length !== 4}
              className="h-14 w-14 rounded-2xl shadow-swiss"
            >
              <Plus className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </div>

      <div className="px-8 py-2 flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30">Recent Links</h3>
        <button onClick={() => peers.forEach(p => p.status === 'offline' && onConnectToPeer(p.id))} className="text-[10px] font-black uppercase tracking-widest text-primary hover:opacity-70 transition-opacity">
          Re-Link All
        </button>
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-2 pb-8">
          {filteredPeers.map((peer) => (
            <button
              key={peer.id}
              onClick={() => onSelectConversation(peer.id)}
              className={`w-full flex items-center gap-4 p-4 rounded-[2rem] transition-all duration-200 group ${
                selectedConversationId === peer.id
                  ? "bg-primary text-primary-foreground shadow-swiss scale-[1.02]"
                  : "hover:bg-secondary"
              }`}
            >
              <div className="relative shrink-0">
                <Avatar className="h-14 w-14 border-4 border-background shadow-sm">
                  <AvatarFallback className={selectedConversationId === peer.id ? "bg-white/20 text-white font-black" : "bg-primary text-white font-black"}>
                    {peer.name[0]}
                  </AvatarFallback>
                </Avatar>
                <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-background ${
                  peer.status === 'online' ? 'bg-green-500' : 'bg-muted-foreground/30'
                }`} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-bold text-lg truncate tracking-tight leading-tight">{peer.name}</p>
                <p className={`text-xs font-bold uppercase tracking-widest truncate ${selectedConversationId === peer.id ? "opacity-60" : "opacity-40"}`}>
                  {peer.status === 'online' ? 'Connected' : 'Offline'}
                </p>
              </div>
              {peer.unreadCount > 0 && (
                <span className={`h-6 min-w-[24px] px-2 flex items-center justify-center rounded-full text-[10px] font-black shadow-sm ${
                  selectedConversationId === peer.id ? "bg-white text-primary" : "bg-primary text-white"
                }`}>
                  {peer.unreadCount}
                </span>
              )}
            </button>
          ))}
          {filteredPeers.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-xs font-bold uppercase tracking-widest opacity-20">No active links</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
