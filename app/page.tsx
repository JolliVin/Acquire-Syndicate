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
  stocks?: Record<string, number>;
};

type Lobby = { 
  id: string; 
  name: string; 
  code: string; 
  status: string; 
  board_state?: string[];
  tile_pool?: string[];
  current_turn_index?: number;
  turn_phase?: string;
  available_stocks?: Record<string, number>;
  active_chains?: string[];
  chain_sizes?: Record<string, number>;
};

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

  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);

  const CORPORATIONS = ['Sackson', 'Festival', 'Tower', 'American', 'Worldwide', 'Imperial', 'Continental'];
  const BOARD_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const BOARD_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // --- CORRECTED: Official RGS Pricing Engine ---
  const getStockPrice = (corp: string, size: number) => {
    // Minimum theoretical size for an active chain is 2
    const effectiveSize = size < 2 ? 2 : size; 

    let basePrice = 0;
    // Low Tier
    if (['Sackson', 'Tower'].includes(corp)) basePrice = 200;
    // Medium Tier
    else if (['Festival', 'Worldwide', 'American'].includes(corp)) basePrice = 300;
    // High Tier
    else if (['Imperial', 'Continental'].includes(corp)) basePrice = 400;

    // RGS Official Tier Step Math
    let tierBonus = 0;
    if (effectiveSize === 3) tierBonus = 100;
    else if (effectiveSize === 4) tierBonus = 200;
    else if (effectiveSize === 5) tierBonus = 300;
    else if (effectiveSize >= 6 && effectiveSize <= 10) tierBonus = 400;
    else if (effectiveSize >= 11 && effectiveSize <= 20) tierBonus = 500;
    else if (effectiveSize >= 21 && effectiveSize <= 30) tierBonus = 600;
    else if (effectiveSize >= 31 && effectiveSize <= 40) tierBonus = 700;
    else if (effectiveSize >= 41) tierBonus = 800;

    return basePrice + tierBonus;
  };

  const getTileValue = (tile: string) => {
    const number = parseInt(tile.match(/\d+/)?.[0] || '0');
    const letter = tile.match(/[A-I]/)?.[0] || 'A';
    const letterValue = letter.charCodeAt(0) - 65; 
    return (letterValue * 100) + number;
  };

  useEffect(() => {
    if (!lobbyInfo) return;

    const fetchInitialData = async () => {
      const { data: pData } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      if (pData) setPlayers(pData);
      
      const { data: lData } = await supabase.from('lobbies').select('*').eq('id', lobbyInfo.id).single();
      if (lData) setLobbyInfo(prev => prev ? { ...prev, ...lData } : null);
    };

    fetchInitialData();

    const lobbyChannel = supabase.channel('lobby-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, 
        (payload) => setLobbyInfo((current) => current ? { ...current, ...payload.new } : null)
      ).subscribe();

    const playerChannel = supabase.channel('player-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setPlayers((current) => [...current, payload.new as Player]);
          else if (payload.eventType === 'UPDATE') setPlayers((current) => current.map(p => p.id === payload.new.id ? payload.new as Player : p));
        }
      ).subscribe();

    return () => { supabase.removeChannel(lobbyChannel); supabase.removeChannel(playerChannel); };
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

  const handleStartGame = async () => {
    setIsStarting(true);
    let pool: string[] = [];
    for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
    pool = pool.sort(() => Math.random() - 0.5);

    let initialBoardState: string[] = [];
    const playersWithStarts = players.map(p => {
      const startingTile = pool.pop()!;
      initialBoardState.push(startingTile);
      return { ...p, starting_tile: startingTile, tile_value: getTileValue(startingTile) };
    });

    playersWithStarts.sort((a, b) => a.tile_value - b.tile_value);
    const playersUpdates = playersWithStarts.map((p, index) => ({
      id: p.id, lobby_id: lobbyInfo!.id, player_name: p.player_name, is_host: p.is_host,
      money: 6000, starting_tile: p.starting_tile, hand: pool.splice(-6), play_order: index 
    }));

    await supabase.from('players').upsert(playersUpdates);
    
    await supabase.from('lobbies').update({ 
      status: 'playing', 
      board_state: initialBoardState, 
      tile_pool: pool, 
      current_turn_index: 0, 
      turn_phase: 'place_tile',
      active_chains: [],
      chain_sizes: { Sackson: 0, Festival: 0, Tower: 0, American: 0, Worldwide: 0, Imperial: 0, Continental: 0 }
    }).eq('id', lobbyInfo!.id);
    
    setIsStarting(false);
  };

  const handlePlaceTile = async (tileToPlace: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || currentPlayer?.player_name !== playerName) return;

    const newHand = currentPlayer.hand?.filter(t => t !== tileToPlace) || [];
    const newBoardState = [...(lobbyInfo.board_state || []), tileToPlace];

    await supabase.from('players').update({ hand: newHand }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ board_state: newBoardState, turn_phase: 'buy_stocks' }).eq('id', lobbyInfo.id);
  };

  const handleBuyStock = async (corp: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || currentPlayer?.player_name !== playerName || stocksBoughtThisTurn >= 3) return;
    
    const currentSize = lobbyInfo.chain_sizes?.[corp] || 0;
    const price = getStockPrice(corp, currentSize); 
    
    if ((currentPlayer.money || 0) < price) {
      alert("Not enough money!");
      return;
    }
    if ((lobbyInfo.available_stocks?.[corp] || 0) <= 0) {
      alert("No stocks left for this corporation!");
      return;
    }

    const newMoney = (currentPlayer.money || 0) - price;
    const newPlayerStocks = { ...currentPlayer.stocks, [corp]: (currentPlayer.stocks?.[corp] || 0) + 1 };
    const newLobbyStocks = { ...lobbyInfo.available_stocks, [corp]: (lobbyInfo.available_stocks?.[corp] || 0) - 1 };

    setStocksBoughtThisTurn(prev => prev + 1);

    await supabase.from('players').update({ money: newMoney, stocks: newPlayerStocks }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ available_stocks: newLobbyStocks }).eq('id', lobbyInfo.id);
  };

  const handleEndTurn = async () => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || currentPlayer?.player_name !== playerName) return;

    const newPool = [...(lobbyInfo.tile_pool || [])];
    const newHand = [...(currentPlayer.hand || [])];
    if (newPool.length > 0) newHand.push(newPool.pop()!);

    const nextTurnIndex = (lobbyInfo.current_turn_index! + 1) % players.length;
    setStocksBoughtThisTurn(0); 

    await supabase.from('players').update({ hand: newHand }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ 
      tile_pool: newPool, 
      current_turn_index: nextTurnIndex,
      turn_phase: 'place_tile'
    }).eq('id', lobbyInfo.id);
  };

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
      <div className={`w-full bg-slate-800 rounded-xl shadow-2xl p-8 transition-all ${lobbyInfo?.status === 'playing' ? 'max-w-6xl' : 'max-w-md'}`}>
        <h1 className="text-3xl font-bold text-center mb-8 tracking-wider text-amber-400">ACQUIRE SYNDICATE</h1>

        {view === 'home' && !lobbyInfo && (
          <div className="flex flex-col gap-4">
            <button onClick={() => { setView('create'); setErrorMessage(''); }} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded transition-colors">CREATE A LOBBY</button>
            <button onClick={() => { setView('join'); setErrorMessage(''); setJoinCodeInput(''); }} className="w-full border-2 border-amber-500 text-amber-500 hover:bg-slate-700 font-bold py-3 px-4 rounded transition-colors">JOIN A LOBBY</button>
          </div>
        )}

        {view === 'create' && !lobbyInfo && (
          <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
            <div><label className="block text-sm font-medium mb-2 text-slate-300">Player Name (Max 10 chars)</label><input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white focus:outline-none focus:border-amber-500" placeholder="Enter name..."/></div>
            {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded text-sm">{errorMessage}</div>}
            <button type="submit" disabled={isCreating} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 px-4 rounded">{isCreating ? 'CREATING...' : 'CREATE'}</button>
            <button type="button" onClick={() => { setView('home'); setErrorMessage(''); }} className="text-sm text-slate-400 hover:text-white mt-2">← Back</button>
          </form>
        )}

        {view === 'join' && !lobbyInfo && (
          <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
            <div><label className="block text-sm font-medium mb-2 text-slate-300">Player Name (Max 10 chars)</label><input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white focus:outline-none focus:border-amber-500" placeholder="Enter name..."/></div>
            <div><label className="block text-sm font-medium mb-2 text-slate-300">Join Code</label><input type="text" maxLength={6} required value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 text-white font-mono uppercase focus:outline-none focus:border-amber-500" placeholder="XXXXXX"/></div>
            {errorMessage && <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded text-sm">{errorMessage}</div>}
            <button type="submit" disabled={isJoining} className="w-full border-2 border-amber-500 text-amber-500 hover:bg-slate-700 font-bold py-3 px-4 rounded">{isJoining ? 'JOINING...' : 'JOIN'}</button>
            <button type="button" onClick={() => { setView('home'); setErrorMessage(''); setJoinCodeInput(''); }} className="text-sm text-slate-400 hover:text-white mt-2">← Back</button>
          </form>
        )}

        {lobbyInfo && lobbyInfo.status === 'waiting' && (
          <div className="space-y-6">
            <div className="bg-slate-700 p-6 rounded-lg text-center"><p className="text-sm text-slate-400">Lobby Code</p><p className="text-4xl font-mono font-bold text-amber-400">{lobbyInfo.code}</p></div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <h3 className="font-bold text-lg text-white mb-2">Players</h3>
              <ul className="space-y-2">{players.map((p) => (<li key={p.id} className="flex justify-between bg-slate-700 px-3 py-2 rounded"><span>{p.player_name}</span>{p.is_host && <span className="text-xs bg-amber-500 text-slate-900 px-2 py-1 rounded font-bold">Host</span>}</li>))}</ul>
            </div>
            {isHost ? <button onClick={handleStartGame} disabled={players.length < 2 || isStarting} className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">{isStarting ? 'STARTING...' : 'START GAME'}</button> : <div className="text-center text-slate-400">Waiting for host...</div>}
          </div>
        )}

        {lobbyInfo && lobbyInfo.status === 'playing' && (
          <div className="flex flex-col lg:flex-row gap-8">
            
            <div className="flex-grow bg-slate-900 p-4 rounded-xl border border-slate-700 overflow-x-auto">
              <div className="min-w-max grid grid-cols-12 gap-1 sm:gap-2">
                {BOARD_ROWS.map((row) => BOARD_COLS.map((col) => {
                  const tileId = `${col}${row}`;
                  const isPlaced = lobbyInfo.board_state?.includes(tileId);
                  return (
                    <div key={tileId} className={`w-8 h-8 sm:w-12 sm:h-12 flex items-center justify-center rounded text-xs sm:text-sm font-bold border-2 transition-colors ${isPlaced ? 'bg-amber-500 text-slate-900 border-amber-600' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                      {tileId}
                    </div>
                  );
                }))}
              </div>
            </div>

            <div className="w-full lg:w-80 flex flex-col gap-4">
              
              <div className="bg-slate-700 p-4 rounded-lg border border-slate-600 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-white">Current Action</h3>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">Tiles Left: {lobbyInfo.tile_pool?.length || 0}</span>
                </div>

                {players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName ? (
                  lobbyInfo.turn_phase === 'place_tile' ? (
                    <div className="text-center py-4">
                      <p className="text-amber-400 mb-2 font-medium">Select a tile to place</p>
                      <p className="text-xs text-slate-400">Your hand is highlighted below.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-amber-400 font-medium text-center">Buy Stocks ({stocksBoughtThisTurn}/3)</p>
                      <div className="grid grid-cols-2 gap-2">
                        {CORPORATIONS.map(corp => {
                          const currentSize = lobbyInfo.chain_sizes?.[corp] || 0;
                          const price = getStockPrice(corp, currentSize);
                          
                          return (
                            <button 
                              key={corp} 
                              onClick={() => handleBuyStock(corp)}
                              disabled={stocksBoughtThisTurn >= 3 || (lobbyInfo.available_stocks?.[corp] || 0) <= 0}
                              className="text-xs bg-slate-800 border border-slate-600 hover:border-amber-400 text-white p-2 rounded flex flex-col items-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <span className="font-bold">{corp}</span>
                              <span className="text-slate-400">${price} | {lobbyInfo.available_stocks?.[corp] || 0} left</span>
                            </button>
                          )
                        })}
                      </div>
                      <button 
                        onClick={handleEndTurn}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded transition-colors"
                      >
                        END TURN & DRAW TILE
                      </button>
                    </div>
                  )
                ) : (
                  <div className="text-center py-6 text-slate-400">
                    Waiting for <strong className="text-white">{players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name}</strong> to play...
                  </div>
                )}
              </div>

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {[...players].sort((a, b) => (a.play_order || 0) - (b.play_order || 0)).map((p, idx) => {
                  const isCurrentTurn = lobbyInfo.current_turn_index === p.play_order;
                  const isMe = p.player_name === playerName;

                  return (
                    <div key={p.id} className={`p-3 rounded-lg border shadow-sm transition-all ${isCurrentTurn ? 'bg-slate-600 border-amber-400' : 'bg-slate-700 border-slate-600'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-white text-sm flex items-center gap-2">
                          {idx + 1}. {p.player_name} {isMe && <span className="text-[10px] bg-slate-500 px-1 rounded uppercase">You</span>}
                        </span>
                        <span className="text-emerald-400 font-mono text-sm">${p.money}</span>
                      </div>
                      
                      <div className="flex flex-wrap gap-1 mb-2">
                        {CORPORATIONS.map(corp => {
                          const count = p.stocks?.[corp] || 0;
                          if (count === 0) return null;
                          return (
                            <span key={corp} className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-600">
                              {corp}: <strong className="text-white">{count}</strong>
                            </span>
                          )
                        })}
                      </div>

                      <div className="text-xs text-slate-400">
                        Hand:
                        <div className="flex flex-wrap gap-1 mt-1">
                          {!isMe ? (
                            p.hand?.map((_, i) => <span key={i} className="w-6 h-8 bg-slate-800 rounded border border-slate-600"></span>)
                          ) : (
                            p.hand?.map(tile => (
                              <button 
                                key={tile} 
                                onClick={() => handlePlaceTile(tile)}
                                disabled={!isCurrentTurn || lobbyInfo.turn_phase !== 'place_tile'}
                                className={`font-mono px-2 py-1 rounded border transition-colors ${isCurrentTurn && lobbyInfo.turn_phase === 'place_tile' ? 'bg-amber-500 text-slate-900 border-amber-600 hover:bg-amber-400 cursor-pointer font-bold' : 'bg-slate-800 text-slate-400 border-slate-600 cursor-not-allowed'}`}
                              >
                                {tile}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

            </div>
          </div>
        )}
      </div>
    </main>
  );
}