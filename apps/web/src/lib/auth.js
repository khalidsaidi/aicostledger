import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
const AuthContext = createContext(undefined);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [blockedReason, setBlockedReason] = useState(null);
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
            setLoading(true);
            if (!nextUser) {
                setUser(null);
                setBlockedReason(null);
                setLoading(false);
                return;
            }
            try {
                setUser(nextUser);
                setBlockedReason(null);
            }
            catch (error) {
                await signOut(auth);
                setUser(null);
                setBlockedReason("Unable to verify access. Try again later.");
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);
    const value = useMemo(() => ({
        user,
        loading,
        blockedReason,
        signIn: async () => {
            await signInWithPopup(auth, googleProvider);
        },
        signOut: async () => {
            await signOut(auth);
        },
        getIdToken: async () => (user ? await user.getIdToken() : null)
    }), [user, loading, blockedReason]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return context;
}
