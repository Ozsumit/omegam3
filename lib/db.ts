import Dexie from "dexie";
import { Message, PeerData, UserProfile, StoredFile } from "@/types";

export class MessagingDB extends Dexie {
  messages!: Dexie.Table<Message, number>;
  peers!: Dexie.Table<PeerData, string>;
  profile!: Dexie.Table<UserProfile, string>;
  files!: Dexie.Table<StoredFile, string>;

  constructor() {
    super("P2P_Chat_DB_v4");
    this.version(1).stores({
      messages: "++id, tempId, conversationId, timestamp",
      peers: "id, name",
      profile: "id",
      files: "id",
    });
  }

  async clearConversation(conversationId: string) {
    const messages = await this.messages.where({ conversationId }).toArray();
    for (const msg of messages) {
      if (msg.fileInfo?.id) {
        await this.files.delete(msg.fileInfo.id);
      }
    }
    return this.messages.where({ conversationId }).delete();
  }

  async deletePeerAndHistory(peerId: string) {
    await this.clearConversation(peerId);
    return this.peers.delete(peerId);
  }
}

export const db = new MessagingDB();
