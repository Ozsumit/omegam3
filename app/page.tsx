"use client";

import { useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useChatManager } from "@/hooks/useChatManager";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sidebar } from "@/components/Sidebar";
import { ChatWindow } from "@/components/ChatWindow";
import { UserProfile } from "@/types";

function WelcomeModal({
  onProfileCreate,
}: {
  onProfileCreate: (name: string) => Promise<any>;
}) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    await onProfileCreate(name);
  };
  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-[500px] rounded-[3rem] p-12 border-none shadow-swiss">
        <DialogHeader>
          <div className="h-20 w-20 bg-primary rounded-[2rem] flex items-center justify-center mb-6">
            <Zap className="h-10 w-10 text-white" />
          </div>
          <DialogTitle className="text-4xl font-black tracking-tighter uppercase italic">Get Started</DialogTitle>
          <DialogDescription className="text-lg font-medium text-muted-foreground">
            Join the Swiss-quality P2P communication network. Secure and fast.
          </DialogDescription>
        </DialogHeader>
        <div className="py-8">
          <Label htmlFor="name" className="text-xs font-black uppercase tracking-widest opacity-40 ml-4 mb-2 block">Display Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-secondary border-none h-16 text-xl font-bold rounded-2xl px-6"
            placeholder="Enter your name"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={isCreating || !name.trim()} className="h-16 w-full rounded-2xl text-lg font-bold bg-primary text-white shadow-swiss">
            {isCreating ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : "Join Network"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppLayout({ profile }: { profile: UserProfile }) {
  const chat = useChatManager(profile);

  const peersArray = Object.values(chat.state.peers)
    .filter((p) => p.id !== profile.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const currentMessages = chat.state.messages[chat.state.selectedConversationId ?? ""] ?? [];

  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden font-sans">
      <div className={`${chat.state.selectedConversationId ? "hidden" : "flex"} md:flex w-full md:w-[400px] lg:w-[450px] shrink-0`}>
        <Sidebar
          profile={profile}
          peers={peersArray}
          selectedConversationId={chat.state.selectedConversationId}
          onSelectConversation={chat.selectConversation}
          onAddPeer={chat.addAndConnectToPeer}
          onConnectToPeer={chat.connectToPeer}
        />
      </div>
      <main className={`${!chat.state.selectedConversationId ? "hidden" : "flex"} md:flex flex-1`}>
        <ChatWindow
          profile={profile}
          selectedConversationId={chat.state.selectedConversationId}
          messages={currentMessages}
          fileTransfers={chat.state.fileTransfers}
          peers={chat.state.peers}
          onSendMessage={chat.sendMessage}
          onSendFile={chat.sendFile}
          onZipAndSendFolder={chat.zipAndSendFolder}
          onDownloadFile={chat.downloadFile}
          onAddReaction={chat.addReaction}
          onBack={() => chat.selectConversation(null)}
          onSendTypingStatus={chat.sendTypingStatus}
          onClearConversationMessages={chat.clearConversationMessages}
          onDeletePeer={chat.deletePeer}
          isPeerTyping={chat.state.selectedConversationId ? chat.state.typingStates[chat.state.selectedConversationId] : false}
        />
      </main>
    </div>
  );
}

export default function Home() {
  const { profile, isLoading, createUserProfile } = useUserProfile();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="animate-bounce">
          <Zap className="h-12 w-12 text-primary" />
        </div>
      </div>
    );
  }

  return (
    <>
      {!profile ? <WelcomeModal onProfileCreate={createUserProfile} /> : <AppLayout profile={profile} />}
      <Toaster />
    </>
  );
}
