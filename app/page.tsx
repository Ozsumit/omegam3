"use client";

import { useState, useRef, useEffect } from "react";
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
      <DialogContent className="sm:max-w-[425px] bg-slate-900 text-white border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Welcome to Omega Chat</DialogTitle>
          <DialogDescription className="text-slate-300">
            Create your profile to start connecting with peers securely.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="name">Display Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-slate-800 border-slate-600 mt-2"
            placeholder="Enter your name"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={isCreating || !name.trim()} className="w-full">
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Get Started
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
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-white overflow-hidden">
      <header className="flex items-center px-6 py-4 bg-slate-900 border-b border-slate-800">
        <Zap className="text-blue-500 mr-2" />
        <h1 className="text-xl font-bold tracking-tight">Omega Chat</h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className={`${chat.state.selectedConversationId ? "hidden" : "flex"} md:flex w-full md:w-80 lg:w-96`}>
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
            onDownloadFile={chat.downloadFile}
            onBack={() => chat.selectConversation(null)}
            onSendTypingStatus={chat.sendTypingStatus}
            onClearConversationMessages={chat.clearConversationMessages}
            onDeletePeer={chat.deletePeer}
            isPeerTyping={chat.state.selectedConversationId ? chat.state.typingStates[chat.state.selectedConversationId] : false}
          />
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  const { profile, isLoading, createUserProfile } = useUserProfile();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
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
