import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  clearStoredAuthToken,
  fetchCurrentTrainer,
  getApiErrorMessage,
  getStoredAuthToken,
  loginTrainer,
  loginTrainerWithGoogle,
  logoutTrainer,
  signupTrainerWithGoogle,
  storeAuthToken
} from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [trainer, setTrainer] = useState(null);
  const [isLoading, setIsLoading] = useState(() => Boolean(getStoredAuthToken()));
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    function handleAuthExpired() {
      setTrainer(null);
    }
    window.addEventListener("days4fitness:auth-expired", handleAuthExpired);
    const token = getStoredAuthToken();
    if (!token) {
      setIsLoading(false);
      return () => {
        mounted = false;
        window.removeEventListener("days4fitness:auth-expired", handleAuthExpired);
      };
    }

    fetchCurrentTrainer()
      .then((user) => {
        if (mounted) setTrainer(user);
      })
      .catch(() => {
        clearStoredAuthToken();
        if (mounted) setTrainer(null);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
      window.removeEventListener("days4fitness:auth-expired", handleAuthExpired);
    };
  }, []);

  const value = useMemo(
    () => ({
      trainer,
      isLoading,
      error,
      async login(credentials) {
        setError("");
        try {
          const result = await loginTrainer(credentials);
          storeAuthToken(result.token);
          setTrainer(result.user);
          return true;
        } catch (requestError) {
          setError(getApiErrorMessage(requestError, "Unable to sign in."));
          return false;
        }
      },
      async loginWithGoogle(credential) {
        setError("");
        try {
          const result = await loginTrainerWithGoogle({ credential });
          storeAuthToken(result.token);
          setTrainer(result.user);
          return true;
        } catch (requestError) {
          setError(getApiErrorMessage(requestError, "Unable to sign in with Google."));
          return false;
        }
      },
      async signupWithGoogle(credential) {
        setError("");
        try {
          const result = await signupTrainerWithGoogle({ credential });
          storeAuthToken(result.token);
          setTrainer(result.user);
          return true;
        } catch (requestError) {
          setError(getApiErrorMessage(requestError, "Unable to sign up with Google."));
          return false;
        }
      },
      async logout() {
        try {
          await logoutTrainer();
        } catch {
          // Local logout should still succeed if the server session already expired.
        }
        clearStoredAuthToken();
        setTrainer(null);
      }
    }),
    [trainer, isLoading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
