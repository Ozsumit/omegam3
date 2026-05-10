import { useState } from "react";
import { Copy, UserPlus, Zap, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <aside className="flex flex-col w-full h-full glass-dark border-r border-white/5">
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 ring-2 ring-blue-500/20">
              <AvatarFallback className="bg-blue-600/20 text-blue-400">{profile.name[0]}</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="font-bold text-sm tracking-tight">{profile.name}</h2>
              <button onClick={copyId} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 uppercase tracking-widest font-semibold">
                ID: {profile.id} <Copy className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-white">
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Search connections..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white/5 border-white/5 pl-10 h-10 focus-visible:ring-blue-500/50"
          />
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Enter Peer ID"
            value={newPeerId}
            onChange={(e) => setNewPeerId(e.target.value)}
            className="bg-white/5 border-white/5 h-9 text-xs"
          />
          <Button size="sm" onClick={() => { onAddPeer(newPeerId); setNewPeerId(""); }} className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/20">
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-4 py-3 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Connections</h3>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-400/10" onClick={() => peers.forEach(p => p.status === 'offline' && onConnectToPeer(p.id))}>
          <Zap className="h-3 w-3 mr-1" /> Connect All
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 space-y-1 pb-4">
          {filteredPeers.map((peer) => (
            <button
              key={peer.id}
              onClick={() => onSelectConversation(peer.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${
                selectedConversationId === peer.id
                  ? "bg-blue-600/10 border border-blue-500/20 shadow-lg shadow-blue-600/5"
                  : "hover:bg-white/5 border border-transparent"
              }`}
            >
              <div className="relative">
                <Avatar className={`h-11 w-11 transition-transform duration-200 group-hover:scale-105 ${selectedConversationId === peer.id ? "ring-2 ring-blue-500/50" : ""}`}>
                  <AvatarFallback className="bg-slate-800 text-slate-300">{peer.name[0]}</AvatarFallback>
                </Avatar>
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-950 ${
                  peer.status === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' :
                  peer.status === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-slate-600'
                }`} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className={`font-semibold text-sm transition-colors ${selectedConversationId === peer.id ? "text-blue-400" : "text-slate-200 group-hover:text-white"}`}>{peer.name}</p>
                <p className="text-[11px] text-slate-500 truncate font-medium">
                  {peer.status === 'online' ? 'Active now' :
                   peer.status === 'connecting' ? 'Establishing link...' :
                   peer.lastSeen ? `Last seen ${new Date(peer.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Offline'}
                </p>
              </div>
              {peer.unreadCount > 0 && (
                <span className="bg-blue-600 text-white text-[10px] font-bold h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full shadow-lg shadow-blue-600/40">
                  {peer.unreadCount}
                </span>
              )}
            </button>
          ))}
          {filteredPeers.length === 0 && (
            <div className="py-10 text-center">
              <p className="text-xs text-slate-500">No connections found</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
