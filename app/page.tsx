'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type Player = { 
  id: string; 
  player_name: string; 
  is_host: boolean;
  money?: number;
  starting_tile?: string;
  hand?: string[];
  play_order?: number;
};

type Lobby = { id: string; name: string; code: string; status: string; board_state?: string[] };

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Helper function to rank tiles (1A is lowest, 12I is highest)
  const getTileValue = (tile: string) => {
    const number = parseInt(tile.match(/\d+/)?.[0] || '0');
    const letter = tile.match(/[A-I]/)?.[0] || 'A';
    const letterValue = letter.charCodeAt(0) - 65; // A=0, B=1, C=2...
    return (letterValue * 100) + number;
  };

  useEffect(() => {
    if (!lobbyInfo) return;

    const fetchInitialData = async () => {
      const { data: pData } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      if (pData) setPlayers(pData);
      
      const { data: lData } = await supabase.from('lobbies').select('*').eq('id', lobbyInfo.id).single();
      if (lData) setLobbyInfo(prev => prev ? { ...prev, status: lData.status, board_state: lData.board_state } : null);
    };

    fetchInitialData();

    // Listen for Game Start (Lobby Updates)
    const lobbyChannel = supabase.channel('lobby-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, 
        (payload) => {
          setLobbyInfo((current) => current ? { ...current, status: payload.new.status, board_state: payload.new.board_state } : null);
        }
      ).subscribe();

    // Listen for Player Updates (Joining & Receiving Hands)
    const playerChannel = supabase.channel('player-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setPlayers((current) => [...current, payload.new as Player]);
          } else if (payload.eventType === 'UPDATE') {
            setPlayers((current) => current.map(p => p.id === payload.new.id ? payload.new as Player : p));
          }
        }
      ).subscribe();

    return () => {
      supabase.removeChannel(lobbyChannel);
      supabase.removeChannel(playerChannel);
    };
  }, [lobbyInfo?.id]);

  const generateJoinCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (playerName.trim() === '') return setErrorMessage('Player name cannot be empty.');
    
    setIsCreating(true);
    const joinCode = generateJoinCode();
    const lobbyName = `${playerName}'s Game`;

    const { data: lobbyData, error: lobbyError } = await supabase.from('lobbies').insert([{ name: lobbyName, join_code: joinCode }]).select().single();
    if (lobbyError) { setErrorMessage(`Lobby Error: ${lobbyError.message}`); setIsCreating(false); return; }

    const { error: playerError } = await supabase.from('players').insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: true }]);
    if (playerError) { setErrorMessage(`Player Error: ${playerError.message}`); } 
    else { setIsHost(true); setLobbyInfo({ id: lobbyData.id, name: lobbyName, code: joinCode, status: 'waiting' }); }
    setIsCreating(false);
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (playerName.trim() === '') return setErrorMessage('Player name cannot be empty.');
    if (joinCodeInput.trim().length !== 6) return setErrorMessage('Join code must be exactly 6 characters.');

    setIsJoining(true);
    const { data: lobbyData, error: lobbyError } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (lobbyError || !lobbyData) { setErrorMessage('Lobby not found.'); setIsJoining(false); return; }
    if (lobbyData.status !== 'waiting') { setErrorMessage('Game has already started.'); setIsJoining(false); return; }

    const { count } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('lobby_id', lobbyData.id);
    if (count !== null && count >= 6) { setErrorMessage('Lobby is full (Max 6).'); setIsJoining(false); return; }

    const { error: playerError } = await supabase.from('players').insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: false }]);
    if (playerError) { setErrorMessage(`Player Error: ${playerError.message}`); } 
    else { setIsHost(false); setLobbyInfo({ id: lobbyData.id, name: lobbyData.name, code: lobbyData.join_code, status: 'waiting' }); }
    setIsJoining(false);
  };

  // --- THE GAME INITIALIZATION ENGINE ---
  const handleStartGame = async () => {
    setIsStarting(true);

    // 1. Generate the 108 Tile Pool
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    let pool: string[] = [];
    for (let r of rows) {
      for (let c = 1; c <= 12; c++) {
        pool.push(`${c}${r}`);
      }
    }

    // 2. Shuffle the tiles
    pool = pool.sort(() => Math.random() - 0.5);

    // 3. Draw initial setup tiles and rank players
    let initialBoardState: string[] = [];
    const playersWithStarts = players.map(p => {
      const startingTile = pool.pop()!;
      initialBoardState.push(startingTile);
      return { ...p, starting_tile: startingTile, tile_value: getTileValue(startingTile) };
    });

    // Sort to determine play order (lowest tile value goes first)
    playersWithStarts.sort((a, b) => a.tile_value - b.tile_value);

    // 4. Deal $6000 and 6 Hand Tiles to everyone, maintaining turn order
    const playersUpdates = playersWithStarts.map((p, index) => ({
      id: p.id,
      lobby_id: lobbyInfo!.id,
      player_name: p.player_name,
      is_host: p.is_host,
      money: 6000,
      starting_tile: p.starting_tile,
      hand: pool.splice(-6), // Take 6 tiles off the top
      play_order: index // 0 goes first, 1 goes second, etc.
    }));

    // 5. Bulk update the database
    await supabase.from('players').upsert(playersUpdates);
    await supabase.from('lobbies').update({ status: 'playing', board_state: initialBoardState }).eq('id', lobbyInfo!.id);
    
    setIsStarting(false);
  };

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
      <div className="max-w-md w-full bg-slate-800 rounded-xl shadow-2xl p-8">
        <h1 className="text-3xl font-bold text-center mb-8 tracking-wider text-amber-400">ACQUIRE SYNDICATE</h1>

        {view === 'home' && !lobbyInfo && (
          <div className="flex flex-col gap-4">
            <button onClick={() => { setView('create'); setErrorMessage(''); }} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded transition-colors">CREATE A LOBBY</button>
            <button onClick={() => { setView('join'); setErrorMessage(''); setJoinCodeInput(''); }} className="w-full border-2 border-amber-500 text-amber-500 hover:bg-slate-700 font-bold py-3 px-4 rounded transition-colors">JOIN A LOBBY</button>
          </div>
        )}

        {/* Create Form */}
        {view === 'create' && !lobbyInfo && (
          <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-300">Player Name (Max 10 chars)</label>
              <input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white focus:outline-none focus:border-amber-500" placeholder="Enter name..."/>
            </div>
            {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded text-sm">{errorMessage}</div>}
            <button type="submit" disabled={isCreating} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded transition-colors disabled:opacity-50">{isCreating ? 'CREATING...' : 'CREATE'}</button>
            <button type="button" onClick={() => { setView('home'); setErrorMessage(''); }} className="text-sm text-slate-400 hover:text-white mt-2">← Back</button>
          </form>
        )}

        {/* Join Form */}
        {view === 'join' && !lobbyInfo && (
          <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-300">Player Name (Max 10 chars)</label>
              <input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white focus:outline-none focus:border-amber-500" placeholder="Enter name..."/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-300">Lobby Join Code</label>
              <input type="text" maxLength={6} required value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white font-mono tracking-widest uppercase focus:outline-none focus:border-amber-500" placeholder="XXXXXX"/>
            </div>
            {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded text-sm">{errorMessage}</div>}
            <button type="submit" disabled={isJoining} className="w-full border-2 border-amber-500 bg-slate-800 text-amber-500 hover:bg-slate-700 font-bold py-3 px-4 rounded transition-colors disabled:opacity-50">{isJoining ? 'JOINING...' : 'JOIN'}</button>
            <button type="button" onClick={() => { setView('home'); setErrorMessage(''); setJoinCodeInput(''); }} className="text-sm text-slate-400 hover:text-white mt-2">← Back</button>
          </form>
        )}

        {/* Live Waiting Room */}
        {lobbyInfo && lobbyInfo.status === 'waiting' && (
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
                    {player.is_host && <span className="text-xs bg-amber-500 text-slate-900 px-2 py-1 rounded font-bold uppercase tracking-wider">Host</span>}
                  </li>
                ))}
              </ul>
            </div>
            {isHost ? (
              <button onClick={handleStartGame} disabled={players.length < 2 || isStarting} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded transition-colors disabled:opacity-50">
                {isStarting ? 'STARTING...' : players.length < 2 ? 'WAITING FOR PLAYERS...' : 'START GAME'}
              </button>
            ) : (
              <div className="text-center text-sm text-slate-400 py-3">Waiting for host to start the game...</div>
            )}
          </div>
        )}

        {/* Temporary Game View to prove initialization worked */}
        {lobbyInfo && lobbyInfo.status === 'playing' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">GAME STARTED</h2>
              <p className="text-amber-400 text-sm mb-6">Initial board setup complete!</p>
            </div>
            
            <div className="space-y-3">
              <h3 className="font-bold text-slate-300 border-b border-slate-700 pb-2">Turn Order (Closest to 1A goes first):</h3>
              {[...players].sort((a, b) => (a.play_order || 0) - (b.play_order || 0)).map((p, idx) => (
                <div key={p.id} className="bg-slate-700 p-3 rounded text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="font-bold text-white">{idx + 1}. {p.player_name}</span>
                    <span className="text-amber-400">${p.money}</span>
                  </div>
                  <div className="text-slate-400">
                    Drawn Tile: <span className="text-white font-mono">{p.starting_tile}</span>
                  </div>
                  <div className="text-slate-400">
                    Hand: <span className="text-white font-mono">{p.hand?.join(', ')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}