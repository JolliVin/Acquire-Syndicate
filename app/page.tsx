'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// --- UTILITY FUNCTIONS (Moved outside to fix 'Cannot find name' errors) ---
const CORPORATIONS = ['Sackson', 'Festival', 'Tower', 'American', 'Worldwide', 'Imperial', 'Continental'];
const BOARD_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const BOARD_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const getTileValue = (tile: string) => {
  const number = parseInt(tile.match(/\d+/)?.[0] || '0');
  const letter = tile.match(/[A-I]/)?.[0] || 'A';
  const letterValue = letter.charCodeAt(0) - 65; 
  return (letterValue * 100) + number;
};

const getStockPrice = (corp: string, size: number) => {
  const effectiveSize = size < 2 ? 2 : size; 
  let basePrice = 0;
  if (['Sackson', 'Tower'].includes(corp)) basePrice = 200;
  else if (['Festival', 'Worldwide', 'American'].includes(corp)) basePrice = 300;
  else if (['Imperial', 'Continental'].includes(corp)) basePrice = 400;

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

// --- TYPES ---
type Player = { 
  id: string; 
  player_name: string; 
  is_host: boolean;
  money: number;
  starting_tile?: string;
  hand: string[];
  play_order: number;
  stocks: Record<string, number>;
};

type Lobby = { 
  id: string; 
  name: string; 
  code: string; 
  status: string; 
  board_state: string[];
  tile_pool: string[];
  current_turn_index: number;
  turn_phase: string;
  available_stocks: Record<string, number>;
  active_chains: string[];
  chain_sizes: Record<string, number>;
  tile_ownership: Record<string, string | null>;
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

  useEffect(() => {
    if (!lobbyInfo) return;
    const fetchInitialData = async () => {
      const { data: pData } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      if (pData) setPlayers(pData as Player[]);
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

  const getNeighbors = (tile: string) => {
    const col = parseInt(tile.match(/\d+/)?.[0] || '0');
    const row = tile.match(/[A-I]/)?.[0] || 'A';
    const rowIndex = BOARD_ROWS.indexOf(row);
    const neighbors = [];
    if (col > 1) neighbors.push(`${col - 1}${row}`);
    if (col < 12) neighbors.push(`${col + 1}${row}`);
    if (rowIndex > 0) neighbors.push(`${col}${BOARD_ROWS[rowIndex - 1]}`);
    if (rowIndex < 8) neighbors.push(`${col}${BOARD_ROWS[rowIndex + 1]}`);
    return neighbors;
  };

  const handlePlaceTile = async (tileToPlace: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName) return;

    const neighbors = getNeighbors(tileToPlace);
    const adjacentPlacedTiles = neighbors.filter(n => lobbyInfo.board_state.includes(n));
    const adjacentCorps = adjacentPlacedTiles.map(n => lobbyInfo.tile_ownership[n]).filter((corp): corp is string => !!corp);
    const uniqueAdjacentCorps = Array.from(new Set(adjacentCorps));

    const safeAdjacentCorps = uniqueAdjacentCorps.filter(corp => (lobbyInfo.chain_sizes[corp] || 0) >= 11);
    if (safeAdjacentCorps.length > 1) {
      alert("Illegal Move: You cannot merge two safe chains (11+ tiles).");
      return;
    }

    let nextPhase = 'buy_stocks';
    let updatedOwnership = { ...lobbyInfo.tile_ownership, [tileToPlace]: null as string | null };

    if (uniqueAdjacentCorps.length > 1) {
      nextPhase = 'merger_resolution'; 
    } 
    else if (uniqueAdjacentCorps.length === 1) {
      const corp = uniqueAdjacentCorps[0];
      updatedOwnership[tileToPlace] = corp;
      const newSizes = { ...lobbyInfo.chain_sizes, [corp]: (lobbyInfo.chain_sizes[corp] || 0) + 1 };
      await supabase.from('lobbies').update({ chain_sizes: newSizes }).eq('id', lobbyInfo.id);
    }
    else if (adjacentPlacedTiles.length > 0 && uniqueAdjacentCorps.length === 0) {
      nextPhase = 'found_chain';
    }

    const newHand = currentPlayer.hand.filter(t => t !== tileToPlace);
    const newBoardState = [...(lobbyInfo.board_state || []), tileToPlace];

    await supabase.from('players').update({ hand: newHand }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ board_state: newBoardState, tile_ownership: updatedOwnership, turn_phase: nextPhase }).eq('id', lobbyInfo.id);
  };

  const handleFoundChain = async (corp: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName) return;

    const lastPlaced = lobbyInfo.board_state[lobbyInfo.board_state.length - 1];
    const neighbors = getNeighbors(lastPlaced);
    const adjacentUnowned = neighbors.filter(n => lobbyInfo.board_state.includes(n) && !lobbyInfo.tile_ownership?.[n]);
    
    const newlyOwnedTiles = [lastPlaced, ...adjacentUnowned];
    const updatedOwnership = { ...lobbyInfo.tile_ownership };
    newlyOwnedTiles.forEach(tile => updatedOwnership[tile] = corp);

    const newPlayerStocks = { ...currentPlayer.stocks, [corp]: (currentPlayer.stocks[corp] || 0) + 1 };
    const newLobbyStocks = { ...lobbyInfo.available_stocks, [corp]: (lobbyInfo.available_stocks[corp] || 0) - 1 };
    
    const newActiveChains = [...(lobbyInfo.active_chains || []), corp];
    const newSizes = { ...lobbyInfo.chain_sizes, [corp]: newlyOwnedTiles.length };

    await supabase.from('players').update({ stocks: newPlayerStocks }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({
      tile_ownership: updatedOwnership, active_chains: newActiveChains, chain_sizes: newSizes, available_stocks: newLobbyStocks, turn_phase: 'buy_stocks'
    }).eq('id', lobbyInfo.id);
  };

  const handleBuyStock = async (corp: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName || stocksBoughtThisTurn >= 3) return;
    const price = getStockPrice(corp, lobbyInfo.chain_sizes[corp] || 0); 
    if (currentPlayer.money < price) return;
    if ((lobbyInfo.available_stocks[corp] || 0) <= 0) return;

    const newMoney = currentPlayer.money - price;
    const newPlayerStocks = { ...currentPlayer.stocks, [corp]: (currentPlayer.stocks[corp] || 0) + 1 };
    const newLobbyStocks = { ...lobbyInfo.available_stocks, [corp]: (lobbyInfo.available_stocks[corp] || 0) - 1 };
    setStocksBoughtThisTurn(prev => prev + 1);

    await supabase.from('players').update({ money: newMoney, stocks: newPlayerStocks }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ available_stocks: newLobbyStocks }).eq('id', lobbyInfo.id);
  };

  const handleEndTurn = async () => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName) return;
    const newPool = [...lobbyInfo.tile_pool];
    const newHand = [...currentPlayer.hand];
    if (newPool.length > 0) newHand.push(newPool.pop()!);
    const nextTurnIndex = (lobbyInfo.current_turn_index + 1) % players.length;
    setStocksBoughtThisTurn(0); 

    await supabase.from('players').update({ hand: newHand }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ tile_pool: newPool, current_turn_index: nextTurnIndex, turn_phase: 'place_tile' }).eq('id', lobbyInfo.id);
  };

  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault(); setErrorMessage('');
    if (playerName.trim() === '') return setErrorMessage('Player name cannot be empty.');
    setIsCreating(true);
    const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: lobbyData, error: lobbyError } = await supabase.from('lobbies').insert([{ name: `${playerName}'s Game`, join_code: joinCode }]).select().single();
    if (lobbyError) { setErrorMessage(`Lobby Error: ${lobbyError.message}`); setIsCreating(false); return; }
    const { error: playerError } = await supabase.from('players').insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: true, money: 6000, hand: [], stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}) }]);
    if (playerError) { setErrorMessage(`Player Error: ${playerError.message}`); } 
    else { setIsHost(true); setLobbyInfo(lobbyData); }
    setIsCreating(false);
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault(); setErrorMessage('');
    if (joinCodeInput.trim().length !== 6) return setErrorMessage('Join code must be 6 characters.');
    setIsJoining(true);
    const { data: lobbyData, error: lobbyError } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (lobbyError || !lobbyData) { setErrorMessage('Lobby not found.'); setIsJoining(false); return; }
    const { error: playerError } = await supabase.from('players').insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: false, money: 6000, hand: [], stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}) }]);
    if (playerError) { setErrorMessage(`Player Error: ${playerError.message}`); } 
    else { setIsHost(false); setLobbyInfo(lobbyData); }
    setIsJoining(false);
  };

  const handleStartGame = async () => {
    if (!lobbyInfo) return;
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
      ...p, starting_tile: p.starting_tile, hand: pool.splice(-6), play_order: index 
    }));
    await supabase.from('players').upsert(playersUpdates);
    await supabase.from('lobbies').update({ 
      status: 'playing', board_state: initialBoardState, tile_pool: pool, current_turn_index: 0, turn_phase: 'place_tile',
      active_chains: [], chain_sizes: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}),
      tile_ownership: initialBoardState.reduce((acc, tile) => ({ ...acc, [tile]: null }), {})
    }).eq('id', lobbyInfo.id);
    setIsStarting(false);
  };

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
      <div className={`w-full bg-slate-800 rounded-xl shadow-2xl p-8 transition-all ${lobbyInfo?.status === 'playing' ? 'max-w-6xl' : 'max-w-md'}`}>
        <h1 className="text-3xl font-bold text-center mb-8 tracking-wider text-amber-400">ACQUIRE SYNDICATE</h1>

        {view === 'home' && !lobbyInfo && (
          <div className="flex flex-col gap-4">
            <button onClick={() => setView('create')} className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">CREATE A LOBBY</button>
            <button onClick={() => setView('join')} className="w-full border-2 border-amber-500 text-amber-500 font-bold py-3 rounded">JOIN A LOBBY</button>
          </div>
        )}

        {view === 'create' && !lobbyInfo && (
          <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
            <input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 p-2 rounded" placeholder="Your Name"/>
            <button type="submit" className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">CREATE</button>
          </form>
        )}

        {view === 'join' && !lobbyInfo && (
          <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
            <input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 p-2 rounded mb-2" placeholder="Your Name"/>
            <input type="text" maxLength={6} required value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} className="w-full bg-slate-700 p-2 rounded" placeholder="JOIN CODE"/>
            <button type="submit" className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">JOIN</button>
          </form>
        )}

        {lobbyInfo && lobbyInfo.status === 'waiting' && (
          <div className="text-center">
            <p className="text-xl mb-4">Lobby Code: <span className="font-mono text-amber-400">{lobbyInfo.code}</span></p>
            <div className="bg-slate-700 p-4 rounded mb-4">
              {players.map(p => <div key={p.id} className="py-1">{p.player_name} {p.is_host && '(Host)'}</div>)}
            </div>
            {isHost && <button onClick={handleStartGame} className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">START GAME</button>}
          </div>
        )}

        {lobbyInfo && lobbyInfo.status === 'playing' && (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="flex-grow bg-slate-900 p-4 rounded-xl border border-slate-700 overflow-x-auto relative">
              {lobbyInfo.turn_phase === 'found_chain' && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                <div className="absolute inset-0 z-10 bg-slate-900/90 flex items-center justify-center p-6 rounded-xl border-4 border-amber-500">
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-amber-400 mb-4">FOUND A HOTEL CHAIN!</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(corp => (
                        <button key={corp} onClick={() => handleFoundChain(corp)} className="bg-slate-800 border border-slate-600 p-3 rounded hover:border-amber-500">{corp}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="min-w-max grid grid-cols-12 gap-1 sm:gap-2">
                {BOARD_ROWS.map((row) => BOARD_COLS.map((col) => {
                  const tileId = `${col}${row}`;
                  const isPlaced = lobbyInfo.board_state.includes(tileId);
                  const corpOwner = lobbyInfo.tile_ownership[tileId];
                  const isSafe = corpOwner && (lobbyInfo.chain_sizes[corpOwner] || 0) >= 11;
                  return (
                    <div key={tileId} className={`w-8 h-8 sm:w-12 sm:h-12 flex items-center justify-center rounded text-[10px] sm:text-xs font-bold border-2 transition-colors 
                      ${isPlaced ? (corpOwner ? (isSafe ? 'bg-slate-300 ring-2 ring-emerald-500 text-black' : 'bg-slate-100 text-black') : 'bg-amber-500 text-black') : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                      {tileId}
                    </div>
                  );
                }))}
              </div>
            </div>

            <div className="w-full lg:w-80 space-y-4">
               <div className="bg-slate-700 p-4 rounded-lg border border-slate-600">
                  <h3 className="font-bold text-white mb-2">Current Turn: {players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name}</h3>
                  {players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName ? (
                    lobbyInfo.turn_phase === 'place_tile' ? <p className="text-amber-400">Place a tile from your hand.</p> :
                    <div className="space-y-4">
                       <p className="text-emerald-400">Buy up to 3 stocks ({stocksBoughtThisTurn}/3)</p>
                       <div className="grid grid-cols-2 gap-2">
                          {CORPORATIONS.filter(c => lobbyInfo.active_chains.includes(c)).map(corp => (
                            <button key={corp} onClick={() => handleBuyStock(corp)} disabled={stocksBoughtThisTurn >= 3} className="text-[10px] bg-slate-800 p-2 rounded border border-slate-600">
                              {corp} (${getStockPrice(corp, lobbyInfo.chain_sizes[corp])})
                            </button>
                          ))}
                       </div>
                       <button onClick={handleEndTurn} className="w-full bg-emerald-600 font-bold py-2 rounded">END TURN</button>
                    </div>
                  ) : <p className="text-slate-400">Waiting...</p>}
               </div>

               <div className="space-y-2 overflow-y-auto max-h-[300px]">
                  {players.map(p => (
                    <div key={p.id} className={`p-2 rounded border text-xs ${lobbyInfo.current_turn_index === p.play_order ? 'border-amber-400 bg-slate-600' : 'border-slate-700 bg-slate-700'}`}>
                      <div className="flex justify-between font-bold"><span>{p.player_name}</span><span>${p.money}</span></div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {CORPORATIONS.map(c => p.stocks[c] > 0 ? <span key={c} className="bg-slate-800 px-1 rounded">{c[0]}: {p.stocks[c]}</span> : null)}
                      </div>
                      {p.player_name === playerName && <div className="flex gap-1 mt-2">{p.hand.map(t => <button key={t} onClick={() => handlePlaceTile(t)} disabled={lobbyInfo.current_turn_index !== p.play_order || lobbyInfo.turn_phase !== 'place_tile'} className="bg-amber-500 text-black px-1 rounded font-mono">{t}</button>)}</div>}
                    </div>
                  ))}
               </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}