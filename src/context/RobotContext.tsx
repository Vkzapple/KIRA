"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { robotClient } from "@/lib/robot-client";
import type { ConnectionStatus, RobotCommand } from "@/lib/types";

interface RobotContextValue {
  status: ConnectionStatus;
  error: string | null;
  connect: (password: string) => Promise<boolean>;
  disconnect: () => void;
  resetError: () => void;
  send: (cmd: RobotCommand) => void;
}

const RobotContext = createContext<RobotContextValue | null>(null);

export function RobotProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<ConnectionStatus>("disconnected");

  const updateStatus = useCallback((next: ConnectionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    robotClient.onClose(() => updateStatus("disconnected"));
  }, [updateStatus]);

  const connect = useCallback(
    async (password: string) => {
      updateStatus("connecting");
      setError(null);
      try {
        await robotClient.connect(password);
        updateStatus("connected");
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal terhubung ke robot.");
        updateStatus("error");
        return false;
      }
    },
    [updateStatus]
  );

  const disconnect = useCallback(() => {
    robotClient.disconnect();
    updateStatus("disconnected");
  }, [updateStatus]);

  const resetError = useCallback(() => {
    setError(null);
    if (statusRef.current === "error") updateStatus("disconnected");
  }, [updateStatus]);

  // Perintah hanya diteruskan saat benar-benar terhubung.
  const send = useCallback((cmd: RobotCommand) => {
    if (statusRef.current === "connected") robotClient.send(cmd);
  }, []);

  const value = useMemo(
    () => ({ status, error, connect, disconnect, resetError, send }),
    [status, error, connect, disconnect, resetError, send]
  );

  return <RobotContext.Provider value={value}>{children}</RobotContext.Provider>;
}

export function useRobot(): RobotContextValue {
  const ctx = useContext(RobotContext);
  if (!ctx) throw new Error("useRobot harus dipakai di dalam RobotProvider");
  return ctx;
}
