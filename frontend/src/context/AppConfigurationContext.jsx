import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchConfiguration, getApiErrorMessage } from "../lib/api.js";

const AppConfigurationContext = createContext(null);

export function AppConfigurationProvider({ children }) {
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let mounted = true;

    setError("");
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
  }, [requestVersion]);

  const value = useMemo(
    () => ({
      configuration,
      error,
      isLoading: !configuration && !error,
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
    [configuration, error]
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
