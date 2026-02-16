'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState(''); // NEW: State for entering a join code
  const [lobbyInfo, setLobbyInfo] = useState<{ name: string, code: string } | null>(null);
  
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false); // NEW: Loading state for joining
  const [errorMessage, setErrorMessage] = useState('');

  const generateJoinCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    
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

    // 2. Add the creator as a player (Host)
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

  // NEW: Function to handle joining an existing lobby
  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (playerName.trim() === '') {
      setErrorMessage('Player name cannot be empty.');
      return;
    }
    if (joinCodeInput.trim().length !== 6) {
      setErrorMessage('Join code must be exactly 6 characters.');
      return;
    }

    setIsJoining(true);

    // 1. Find the lobby by its join code
    const { data: lobbyData, error: lobbyError } = await supabase
      .from('lobbies')
      .select('*')
      .eq('join_code', joinCodeInput.toUpperCase())
      .single();

    if (lobbyError || !lobbyData) {
      setErrorMessage('Lobby not found. Please check the code and try again.');
      setIsJoining(false);
      return;
    }

    // 2. Add the joining user as a player (Non-Host)
    const { error: playerError } = await supabase
      .from('players')
      .insert([{
        lobby_id: lobbyData.id,
        player_name: playerName,
        is_host: false
      }]);

    if (playerError) {
      setErrorMessage(`Player Error: ${playerError.message}`);
    } else {
      setLobbyInfo({ name: lobbyData.name, code: lobbyData.join_code });
    }
    setIsJoining(false);
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
              onClick={() => { setView('join'); setErrorMessage(''); setJoinCodeInput(''); }}
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

        {/* NEW: Join Lobby View */}
        {view === 'join' && !lobbyInfo && (
          <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
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
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-300">
                Lobby Join Code
              </label>
              <input
                type="text"
                maxLength={6}
                required
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white font-mono tracking-widest uppercase focus:outline-none focus:border-amber-500"
                placeholder="XXXXXX"
              />
            </div>

            {errorMessage && (
              <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded text-sm">
                {errorMessage}
              </div>
            )}

            <button 
              type="submit"
              disabled={isJoining}
              className="w-full border-2 border-amber-500 bg-slate-800 text-amber-500 hover:bg-slate-700 font-bold py-3 px-4 rounded transition-colors disabled:opacity-50"
            >
              {isJoining ? 'JOINING...' : 'JOIN'}
            </button>
            <button 
              type="button"
              onClick={() => { setView('home'); setErrorMessage(''); setJoinCodeInput(''); }}
              className="text-sm text-slate-400 hover:text-white mt-2"
            >
              ← Back
            </button>
          </form>
        )}

        {/* Lobby Joined/Created View */}
        {lobbyInfo && (
          <div className="text-center space-y-6">
            <div className="bg-slate-700 p-6 rounded-lg border border-slate-600">
              <p className="text-sm text-slate-400 uppercase tracking-wide mb-1">Lobby Name</p>
              <p className="text-xl font-bold text-white mb-4">{lobbyInfo.name}</p>
              
              <p className="text-sm text-slate-400 uppercase tracking-wide mb-1">Join Code</p>
              <p className="text-4xl font-mono font-bold text-amber-400 tracking-widest">{lobbyInfo.code}</p>
            </div>
            <p className="text-sm text-slate-300">Waiting for other players...</p>
          </div>
        )}
      </div>
    </main>
  );
}