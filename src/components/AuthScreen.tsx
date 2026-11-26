import React, { useState } from 'react';
import { Lock, ShieldCheck, User, AlertCircle } from 'lucide-react';
import { api, setAuthToken, type AuthStatusResponse } from '../services/api';
import type { UserAccount } from '../shared/types';

interface AuthScreenProps {
  authStatus: AuthStatusResponse;
  onAuthenticated: (user: UserAccount) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ authStatus, onAuthenticated }) => {
  const isBootstrap = !authStatus.hasAdmin;
  const [username, setUsername] = useState(isBootstrap ? 'admin' : '');
  const [displayName, setDisplayName] = useState(isBootstrap ? 'Administrateur Système' : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (isBootstrap) {
        if (password !== confirmPassword) {
          throw new Error('Les mots de passe ne correspondent pas.');
        }
        const res = await api.bootstrapAdmin({
          username,
          displayName,
          password,
          adminPasscode: adminPasscode || undefined,
        });
        setAuthToken(res.token);
        onAuthenticated(res.user);
      } else {
        const res = await api.login(username, password);
        setAuthToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d’authentification');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[#2448C9] text-white flex items-center justify-center font-display font-bold text-lg">
            C
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display tracking-tight">Cadence</h1>
            <p className="text-xs text-slate-500">Gestion de projets, Gantt &amp; gouvernance</p>
          </div>
        </div>

        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-900">
            {isBootstrap ? 'Initialisation Administrateur' : 'Connexion à votre espace'}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {isBootstrap
              ? 'Créez le premier compte Administrateur local pour configurer l’organisation et charger les utilisateurs.'
              : 'Saisissez votre identifiant et votre mot de passe.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Identifiant
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex. nadia.r ou admin"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2448C9]/30 focus:border-[#2448C9]"
              />
            </div>
          </div>

          {isBootstrap && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nom complet
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2448C9]/30 focus:border-[#2448C9]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mot de passe
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                minLength={isBootstrap ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isBootstrap ? '8 caractères minimum' : 'Votre mot de passe'}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2448C9]/30 focus:border-[#2448C9]"
              />
            </div>
          </div>

          {isBootstrap && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirmer le mot de passe
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2448C9]/30 focus:border-[#2448C9]"
                />
              </div>
              {authStatus.envPasscodeConfigured && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Code serveur (ADMIN_PASSCODE)
                  </label>
                  <input
                    type="password"
                    required
                    value={adminPasscode}
                    onChange={(e) => setAdminPasscode(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2448C9]/30 focus:border-[#2448C9]"
                  />
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-lg bg-[#2448C9] hover:bg-[#1d3aa3] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            {submitting
              ? 'Vérification...'
              : isBootstrap
              ? 'Créer le compte Administrateur'
              : 'Se connecter'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
          <span>Session sécurisée · Expiration 30 min</span>
          <span>Verrouillage 5 essais</span>
        </div>
      </div>
    </div>
  );
};
