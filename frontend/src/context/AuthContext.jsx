import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  clearStoredAuthToken,
  fetchCurrentTrainer,
  getApiErrorCode,
  getApiErrorMessage,
  getStoredAuthToken,
  loginTrainer,
  loginTrainerWithGoogle,
  logoutTrainer,
  signupTrainer,
  signupTrainerWithGoogle,
  storeAuthToken
} from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [trainer, setTrainer] = useState(null);
  const [isLoading, setIsLoading] = useState(() => Boolean(getStoredAuthToken()));
  const [error, setError] = useState("");
  // AUTH-08: the page needs the code as well as the text, so a sign-in that
  // failed because there is no account can offer sign-up instead of an error.
  const [errorCode, setErrorCode] = useState("");

  const fail = (requestError, fallback) => {
    setError(getApiErrorMessage(requestError, fallback));
    setErrorCode(getApiErrorCode(requestError));
    return false;
  };

  const clearError = () => {
    setError("");
    setErrorCode("");
  };

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
      errorCode,
      async login(credentials) {
        clearError();
        try {
          const result = await loginTrainer(credentials);
          storeAuthToken(result.token);
          setTrainer(result.user);
          return true;
        } catch (requestError) {
          return fail(requestError, "Unable to sign in.");
        }
      },
      async loginWithGoogle(credential) {
        clearError();
        try {
          const result = await loginTrainerWithGoogle({ credential });
          storeAuthToken(result.token);
          setTrainer(result.user);
          return true;
        } catch (requestError) {
          return fail(requestError, "Unable to sign in with Google.");
        }
      },
      async signup(details) {
        clearError();
        try {
          const result = await signupTrainer(details);
          storeAuthToken(result.token);
          setTrainer(result.user);
          return true;
        } catch (requestError) {
          return fail(requestError, "Unable to create the account.");
        }
      },
      async signupWithGoogle(credential) {
        clearError();
        try {
          const result = await signupTrainerWithGoogle({ credential });
          storeAuthToken(result.token);
          setTrainer(result.user);
          return true;
        } catch (requestError) {
          return fail(requestError, "Unable to sign up with Google.");
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
    [trainer, isLoading, error, errorCode]
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
