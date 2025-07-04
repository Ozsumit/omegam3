// /hooks/useUserProfile.ts
import { useState, useEffect } from "react";
import { db } from "@/lib/db";
import { UserProfile } from "@/types";
import { generateNumericId } from "@/lib/utils";

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      setIsLoading(true);
      try {
        let userProfile = await db.profile.get("user");
        if (!userProfile) {
          // If no profile, we wait for user to create one
          setIsLoading(false);
          return;
        }
        setProfile(userProfile);
      } catch (error) {
        console.error("Failed to load user profile:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadProfile();
  }, []);

  const createUserProfile = async (name: string): Promise<UserProfile> => {
    if (!name.trim()) throw new Error("Display name cannot be empty.");

    const newProfile: UserProfile = {
      id: generateNumericId().toString(),
      name,
      preferences: { theme: "dark", autoDownload: true },
    };

    await db.profile.put(newProfile, "user");
    setProfile(newProfile);
    return newProfile;
  };

  return { profile, isLoading, createUserProfile };
}

// utils.ts

// (other utility functions)

export function generateNumericId(): number {
  // Simple numeric ID generator (example: timestamp + random)
  return Date.now() + Math.floor(Math.random() * 10000);
}
