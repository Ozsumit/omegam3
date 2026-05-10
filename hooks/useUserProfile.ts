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
        // Try getting ID from localStorage first to ensure consistency
        const storedId = localStorage.getItem("omega_user_id");
        let userProfile;

        if (storedId) {
          userProfile = await db.profile.get(storedId);
        } else {
          // Fallback to searching the whole profile table (should only have one entry usually)
          const allProfiles = await db.profile.toArray();
          if (allProfiles.length > 0) {
            userProfile = allProfiles[0];
            localStorage.setItem("omega_user_id", userProfile.id);
          }
        }

        if (userProfile) {
          setProfile(userProfile);
        }
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

    // Check if we already have an ID in localStorage
    let userId = localStorage.getItem("omega_user_id");
    if (!userId) {
      userId = generateNumericId();
      localStorage.setItem("omega_user_id", userId);
    }

    const newProfile: UserProfile = {
      id: userId,
      name,
    };

    await db.profile.put(newProfile);
    setProfile(newProfile);
    return newProfile;
  };

  return { profile, isLoading, createUserProfile };
}
