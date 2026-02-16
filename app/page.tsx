'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Defining types for our data
type Player = { id: string, player_name: string, is_host: boolean };
type Lobby = { id: string, name: string, code: string };

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // NEW: Real-time subscription hook
  useEffect(() => {
    if (!lobbyInfo) return;

    // 1. Fetch players already in the lobby
    const fetchPlayers = async () => {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('lobby_id', lobbyInfo.id)
        .order('created_at', { ascending: true });
        
      if (data) setPlayers(data);
      if (error) console.error("Error fetching players:", error);
    };

    fetchPlayers();

    // 2. Subscribe to new players joining in real-time
    const channel = supabase
      .channel('lobby-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'players',
          filter: `lobby_id=eq.${lobbyInfo.id}`,
        },
        (payload) => {
          // When a new player joins, add them to our local list
          setPlayers((currentPlayers) => [...currentPlayers, payload.new as Player]);
        }
      )
      .subscribe();

    // Cleanup subscription when leaving the page
    return () => {
      supabase.removeChannel(channel);
    };
  }, [lobbyInfo]);

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

    const { error: playerError } = await supabase
      .from('players')
      .insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: true }]);

    if (playerError) {
      setErrorMessage(`Player Error: ${playerError.message}`);
    } else {
      setIsHost(true);
      // NOTE: We now store the database ID so our useEffect knows which lobby to listen to
      setLobbyInfo({ id: lobbyData.id, name: lobbyName, code: joinCode }); 
    }
    setIsCreating(false);
  };

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

    // Check if lobby is full (Acquire max is 6)
    const { count } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('lobby_id', lobbyData.id);

    if (count !== null && count >= 6) {
      setErrorMessage('This lobby is full (Max 6 players).');
      setIsJoining(false);
      return;
    }

    const { error: playerError } = await supabase
      .from('players')
      .insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: false }]);

    if (playerError) {
      setErrorMessage(`Player Error: ${playerError.message}`);
    } else {
      setIsHost(false);
      setLobbyInfo({ id: lobbyData.id, name: lobbyData.name, code: lobbyData.join_code });
    }
    setIsJoining(false);
  };

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
      <div className="max-w-md w-full bg-slate-800 rounded-xl shadow-2xl p-8">
        <h1 className="text-3xl font-bold text-center mb-8 tracking-wider text-amber-400">
          ACQUIRE SYNDICATE
        </h1>

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

        {view === 'create' && !lobbyInfo && (
          <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
            {/* Form inputs omitted for brevity, identical to previous code */}
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

        {view === 'join' && !lobbyInfo && (
          <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
             {/* Form inputs omitted for brevity, identical to previous code */}
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

        {/* NEW: Live Waiting Room View */}
        {lobbyInfo && (
          <div className="space-y-6">
            <div className="bg-slate-700 p-6 rounded-lg border border-slate-600 text-center">
              <p className="text-sm text-slate-400 uppercase tracking-wide mb-1">Lobby Code</p>
              <p className="text-4xl font-mono font-bold text-amber-400 tracking-widest">{lobbyInfo.code}</p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-2">
                <h3 className="font-bold text-lg text-white">Players</h3>
                <span className="text-sm text-amber-400 font-mono">{players.length} / 6</span>
              </div>
              
              <ul className="space-y-2">
                {players.map((player) => (
                  <li key={player.id} className="flex justify-between items-center bg-slate-700 px-3 py-2 rounded">
                    <span className="font-medium text-slate-200">{player.player_name}</span>
                    {player.is_host && (
                      <span className="text-xs bg-amber-500 text-slate-900 px-2 py-1 rounded font-bold uppercase tracking-wider">
                        Host
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              
              {players.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">Loading players...</p>
              )}
            </div>

            {isHost ? (
              <button 
                disabled={players.length < 2}
                className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {players.length < 2 ? 'WAITING FOR PLAYERS...' : 'START GAME'}
              </button>
            ) : (
              <div className="text-center text-sm text-slate-400 py-3">
                Waiting for host to start the game...
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}