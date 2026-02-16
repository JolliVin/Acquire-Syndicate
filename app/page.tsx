'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [playerName, setPlayerName] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<{ name: string, code: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState(''); // NEW: Error state

  const generateJoinCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(''); // Clear previous errors
    
    if (playerName.trim() === '') {
      setErrorMessage('Player name cannot be empty.');
      return;
    }
    
    setIsCreating(true);
    const joinCode = generateJoinCode();
    const lobbyName = `${playerName}'s Game`;

    // 1. Create the lobby
    const { data: lobbyData, error: lobbyError } = await supabase
      .from('lobbies')
      .insert([{ name: lobbyName, join_code: joinCode }])
      .select()
      .single();

    if (lobbyError) {
      setErrorMessage(`Lobby Error: ${lobbyError.message}`);
      setIsCreating(false);
      return;
    }

    // 2. Add the creator as a player
    const { error: playerError } = await supabase
      .from('players')
      .insert([{ 
        lobby_id: lobbyData.id, 
        player_name: playerName, 
        is_host: true 
      }]);

    if (playerError) {
      setErrorMessage(`Player Error: ${playerError.message}`);
    } else {
      setLobbyInfo({ name: lobbyName, code: joinCode });
    }
    setIsCreating(false);
  };

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
      <div className="max-w-md w-full bg-slate-800 rounded-xl shadow-2xl p-8">
        <h1 className="text-3xl font-bold text-center mb-8 tracking-wider text-amber-400">
          ACQUIRE SYNDICATE
        </h1>

        {/* Home View */}
        {view === 'home' && (
          <div className="flex flex-col gap-4">
            <button 
              onClick={() => { setView('create'); setErrorMessage(''); }}
              className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded transition-colors"
            >
              CREATE A LOBBY
            </button>
            <button 
              onClick={() => { setView('join'); setErrorMessage(''); }}
              className="w-full border-2 border-amber-500 text-amber-500 hover:bg-slate-700 font-bold py-3 px-4 rounded transition-colors"
            >
              JOIN A LOBBY
            </button>
          </div>
        )}

        {/* Create Lobby View */}
        {view === 'create' && !lobbyInfo && (
          <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-300">
                Player Name (Max 10 chars)
              </label>
              <input
                type="text"
                maxLength={10}
                required
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white focus:outline-none focus:border-amber-500"
                placeholder="Enter name..."
              />
            </div>
            
            {/* NEW: Error Display Box */}
            {errorMessage && (
              <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded text-sm">
                {errorMessage}
              </div>
            )}

            <button 
              type="submit"
              disabled={isCreating}
              className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded transition-colors disabled:opacity-50"
            >
              {isCreating ? 'CREATING...' : 'CREATE'}
            </button>
            <button 
              type="button"
              onClick={() => { setView('home'); setErrorMessage(''); }}
              className="text-sm text-slate-400 hover:text-white mt-2"
            >
              ← Back
            </button>
          </form>
        )}

        {/* Lobby Created View */}
        {lobbyInfo && (
          <div className="text-center space-y-6">
            <div className="bg-slate-700 p-6 rounded-lg border border-slate-600">
              <p className="text-sm text-slate-400 uppercase tracking-wide mb-1">Lobby Name</p>
              <p className="text-xl font-bold text-white mb-4">{lobbyInfo.name}</p>
              
              <p className="text-sm text-slate-400 uppercase tracking-wide mb-1">Join Code</p>
              <p className="text-4xl font-mono font-bold text-amber-400 tracking-widest">{lobbyInfo.code}</p>
            </div>
            <p className="text-sm text-slate-300">Share this code with other players to let them join.</p>
          </div>
        )}

        {/* Join Lobby Placeholder */}
        {view === 'join' && (
          <div className="text-center">
            <p className="text-slate-300 mb-4">Join logic will be implemented here.</p>
            <button 
              onClick={() => setView('home')}
              className="text-sm text-slate-400 hover:text-white"
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </main>
  );
}