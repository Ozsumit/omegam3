import { useState, useEffect, useRef, useCallback } from "react";
import Peer, { DataConnection } from "peerjs";
import { UserProfile, PeerMessagePayload } from "@/types";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/lib/db";

const HEARTBEAT_INTERVAL = 15000;

export function usePeer({
  profile,
  onDataReceived,
  onPeerConnected,
  onPeerDisconnected,
}: {
  profile: UserProfile | null;
  onDataReceived: (peerId: string, data: PeerMessagePayload) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string, error?: boolean) => void;
}) {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [isPeerReady, setIsPeerReady] = useState<boolean>(false);
  const connectionsRef = useRef<Record<string, DataConnection>>({});
  const heartbeatsRef = useRef<Record<string, NodeJS.Timeout>>({});

  const callbacksRef = useRef({ onDataReceived, onPeerConnected, onPeerDisconnected });

  useEffect(() => {
    callbacksRef.current = { onDataReceived, onPeerConnected, onPeerDisconnected };
  }, [onDataReceived, onPeerConnected, onPeerDisconnected]);

  const cleanupConnection = useCallback((peerId: string) => {
    if (heartbeatsRef.current[peerId]) {
      clearInterval(heartbeatsRef.current[peerId]);
      delete heartbeatsRef.current[peerId];
    }
    delete connectionsRef.current[peerId];
  }, []);

  const setupConnection = useCallback(
    (conn: DataConnection) => {
      conn.on("open", () => {
        console.log(`Connection established with ${conn.peer}`);
        connectionsRef.current[conn.peer] = conn;
        callbacksRef.current.onPeerConnected(conn.peer);

        if (profile) {
          conn.send({
            type: "profile-info",
            payload: { id: profile.id, name: profile.name },
          });
        }

        heartbeatsRef.current[conn.peer] = setInterval(() => {
          if (conn.open) {
            conn.send({ type: "ping" });
          } else {
            cleanupConnection(conn.peer);
            callbacksRef.current.onPeerDisconnected(conn.peer);
          }
        }, HEARTBEAT_INTERVAL);
      });

      conn.on("data", (data: unknown) => {
        const payload = data as PeerMessagePayload;
        if (payload.type === "ping") {
          conn.send({ type: "pong" });
          return;
        }
        if (payload.type === "pong") return;

        callbacksRef.current.onDataReceived(conn.peer, payload);
      });

      const handleClose = () => {
        console.log(`Connection closed with ${conn.peer}`);
        cleanupConnection(conn.peer);
        callbacksRef.current.onPeerDisconnected(conn.peer);
      };

      conn.on("close", handleClose);
      conn.on("error", (err) => {
        console.error(`Connection error with ${conn.peer}:`, err);
        cleanupConnection(conn.peer);
        callbacksRef.current.onPeerDisconnected(conn.peer, true);
      });
    },
    [profile, cleanupConnection]
  );

  useEffect(() => {
    if (!profile || peer) return;

    const newPeer = new Peer(profile.id, {
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
        ],
      },
    });
    setPeer(newPeer);

    newPeer.on("open", (id) => {
      console.log("My peer ID is: " + id);
      setIsPeerReady(true);
    });

    newPeer.on("connection", (conn) => setupConnection(conn));

    newPeer.on("error", (err) => {
      console.error("PeerJS global error:", err);
    });

    newPeer.on("disconnected", () => {
      console.log("Peer disconnected from server, attempting to reconnect...");
      newPeer.reconnect();
    });

    return () => {
      Object.keys(heartbeatsRef.current).forEach(id => clearInterval(heartbeatsRef.current[id]));
      newPeer.destroy();
    };
  }, [profile]);

  const connectToPeer = useCallback(
    (remotePeerId: string) => {
      if (!peer || !isPeerReady || !remotePeerId) return;
      if (connectionsRef.current[remotePeerId]?.open) return;

      const conn = peer.connect(remotePeerId, { reliable: true });
      setupConnection(conn);
    },
    [peer, isPeerReady, setupConnection]
  );

  const reconnectToPastPeers = useCallback(async () => {
    if (!profile || !isPeerReady) return;
    const pastPeers = await db.peers.toArray();
    pastPeers.forEach((peerData) => {
      if (peerData.id !== profile.id && !connectionsRef.current[peerData.id]?.open) {
        connectToPeer(peerData.id);
      }
    });
  }, [connectToPeer, profile, isPeerReady]);

  const sendMessageToPeer = useCallback((peerId: string, data: PeerMessagePayload): boolean => {
    const conn = connectionsRef.current[peerId];
    if (conn?.open) {
      conn.send(data);
      return true;
    }
    return false;
  }, []);

  return {
    peerId: profile?.id,
    isPeerReady,
    connectToPeer,
    reconnectToPastPeers,
    sendMessageToPeer,
  };
}
