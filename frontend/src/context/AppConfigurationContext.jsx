import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchConfiguration, getApiErrorMessage } from "../lib/api.js";
import { useAuth } from "./AuthContext.jsx";

const AppConfigurationContext = createContext(null);

export function AppConfigurationProvider({ children }) {
  const { trainer } = useAuth();
  // Settings belong to a trainer since AUTH-05, so there is nothing to fetch
  // until somebody is signed in, and a different trainer means a different
  // configuration rather than a stale one.
  const trainerId = trainer?.id ?? null;
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let mounted = true;

    setError("");
    if (!trainerId) {
      setConfiguration(null);
      return undefined;
    }

    fetchConfiguration()
      .then((data) => {
        if (mounted) setConfiguration(data);
      })
      .catch((requestError) => {
        if (mounted) {
          setError(getApiErrorMessage(requestError, "Unable to load application configuration."));
        }
      });

    return () => {
      mounted = false;
    };
  }, [trainerId, requestVersion]);

  const value = useMemo(
    () => ({
      configuration,
      error,
      // Nobody signed in is not "still loading": the login screen needs no
      // configuration at all.
      isLoading: Boolean(trainerId) && !configuration && !error,
      // The settings endpoints return the full configuration, so a save can
      // refresh the app without a round trip or a loading flash.
      applyConfiguration(next) {
        setConfiguration(next);
      },
      reload() {
        setConfiguration(null);
        setRequestVersion((current) => current + 1);
      },
      packagePrice(sessionType, sessionsTotal) {
        return (
          configuration?.pricing.find(
            (item) => item.sessionType === sessionType && item.sessionsTotal === Number(sessionsTotal)
          )?.price ?? 0
        );
      },
      timeSlotsForDay(day) {
        return configuration?.businessHours.find((item) => item.day === day)?.timeSlots ?? [];
      }
    }),
    [configuration, error, trainerId]
  );

  return <AppConfigurationContext.Provider value={value}>{children}</AppConfigurationContext.Provider>;
}

export function useAppConfiguration() {
  const context = useContext(AppConfigurationContext);
  if (!context) {
    throw new Error("useAppConfiguration must be used inside AppConfigurationProvider");
  }
  return context;
}
