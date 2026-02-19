'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Peer } from 'peerjs';

// --- INTERFACES & DIRECTIVES ---

/**
 * Operative Profile Data
 * Represents a single player's state within the grid.
 */
interface Player {
  id: string;
  lobby_id: string;
  player_name: string;
  is_host: boolean;
  is_spectator: boolean;
  money: number;
  hand: string[];
  play_order: number | null;
  stocks: Record<string, number>;
  starting_tile: string | null;
  wants_to_swap?: boolean; 
  // --- FAILSAFE ENGINE FIELDS ---
  last_seen?: string;       // Pulse timestamp for connection monitoring
  wants_restart?: boolean;  // Consensus flag for mission reset
}

/**
 * Acquisition & Merger Logistics
 * Tracks the state of a corporate takeover.
 */
interface MergerData {
  survivor?: string;
  current_defunct?: string;
  defunct_corps?: string[];
  tile_placed?: string;
}

/**
 * Tactical Lobby Environment
 * The primary data container for the game session.
 */
interface Lobby {
  id: string;
  join_code: string;
  status: string;
  board_state: string[];
  turn_phase: string;
  current_turn_index: number;
  chain_sizes: Record<string, number>;
  active_chains: string[];
  tile_ownership: Record<string, string | null>;
  available_stocks: Record<string, number>;
  tile_pool: string[];
  merger_data: MergerData;
  disposition_turn_index: number;
  // --- FAILSAFE ENGINE FIELDS ---
  is_paused?: boolean;      // Tactical lockdown state
  reconnect_timer?: string; // Critical extraction window timestamp
  // Session Termination Logic
  end_session_data?: { 
    phase?: string, 
    yesVotes?: string[], 
    noVotes?: string[] 
  };
  // --- NEW: LEADERSHIP DATA ---
  host_transfer_data?: {
    targetId: string | null;
    rejectedIds: string[];
    status: 'none' | 'pending';
    isAutoMigration?: boolean;
  };
}

// --- CONSTANTS & METADATA ---

const CORP_METADATA: Record<string, { bg: string, text: string, border: string }> = {
  Sackson: { bg: 'bg-red-600', text: 'text-white', border: 'border-red-400' },
  Festival: { bg: 'bg-green-600', text: 'text-white', border: 'border-green-400' },
  Tower: { bg: 'bg-yellow-500', text: 'text-black', border: 'border-yellow-300' },
  American: { bg: 'bg-blue-800', text: 'text-white', border: 'border-blue-600' },
  Worldwide: { bg: 'bg-purple-600', text: 'text-white', border: 'border-purple-400' },
  Imperial: { bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-400' },
  Continental: { bg: 'bg-sky-400', text: 'text-black', border: 'border-sky-300' },
};

const CORPORATIONS = Object.keys(CORP_METADATA);
const BOARD_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const BOARD_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Official Protocol Archive
 * Core rules database for in-game lookup.
 */
const RULEBOOK = [
  { id: 'turn', title: 'Sequence of Play', tags: ['turn', 'order', 'steps'], text: 'A player’s turn consists of three steps in this exact order: 1. Place one tile onto the grid. 2. Buy up to three stocks of any active corporations. 3. Draw one tile to replace the played tile.' },
  { id: 'founding', title: 'Founding a Corporation', tags: ['found', 'start', 'create', 'new', 'bonus'], text: 'When a tile is placed next to an unassociated tile, a corporation is founded. The player chooses any available corporation and receives 1 free stock of that corporation as a founder\'s bonus. If all 7 corporations are active, you cannot place a tile that would found an 8th.' },
  { id: 'growing', title: 'Growing a Corporation', tags: ['grow', 'expand', 'size'], text: 'When a tile is placed adjacent to an existing corporation, it becomes part of that corporation, increasing its size and stock value.' },
  { id: 'merging', title: 'Merging Corporations', tags: ['merge', 'hostile', 'takeover', 'tie'], text: 'When a tile is placed adjacent to two or more different corporations, a merger occurs. The corporation with the most tiles survives; the smaller ones become defunct. If there is a tie for size, the player who placed the merging tile chooses the survivor.' },
  { id: 'bonuses', title: 'Merger Bonuses', tags: ['bonus', 'payout', 'majority', 'minority', 'tie'], text: 'When a corporation goes defunct, the Primary (Largest) and Secondary (Second Largest) stockholders are paid bonuses based on the defunct corporation\'s size before the merger. If there is a tie for Primary, the Primary and Secondary bonuses are combined, divided equally among tied players, and rounded UP to the nearest $100. If there is a tie for Secondary, the Secondary bonus is divided equally and rounded UP to the nearest $100. If only one player owns stock, they receive BOTH bonuses.' },
  { id: 'disposition', title: 'Disposition of Defunct Stock', tags: ['sell', 'trade', 'keep', 'disposition'], text: 'Starting with the merger-maker and proceeding clockwise, players must declare what to do with their defunct stock: 1. SELL to the bank at the defunct corporation\'s pre-merger price. 2. TRADE 2 defunct stocks for 1 survivor stock (if the bank has enough). 3. KEEP the defunct stock in hopes the corporation is re-founded later.' },
  { id: 'safe', title: 'Safe Corporations', tags: ['safe', '11', 'protect', 'unplayable', 'dead'], text: 'A corporation with 11 or more tiles is "Safe" and can never be swallowed in a merger. A tile that would merge two Safe corporations is permanently unplayable (a "Dead Tile"). You may swap a Dead Tile for a new one instead of placing a tile on your turn.' },
  { id: 'end', title: 'Ending the Game', tags: ['end', 'win', '41', 'finish'], text: 'The game ends when a player announces it on their turn under one of two conditions: 1. ALL active corporations are Safe (11+ tiles). OR 2. ANY single active corporation has 41 or more tiles. Upon announcement, all majority/minority bonuses are paid out, and all remaining stocks are sold back at current value. The player with the most money wins.' },
];

// --- UTILITY ENGINES ---

/**
 * Play Terminal Ping
 * Synthesizes a square-wave notification sound.
 */
const playTerminalPing = () => {
  if (typeof window === 'undefined') return;
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.error("Audio Block: Directive failed due to missing user interaction.", e);
  }
};

/**
 * Get Tile Value
 * Converts grid coordinates (e.g., '12A') into a numeric weight for sorting.
 */
const getTileValue = (tile: string) => {
  const num = parseInt(tile.match(/\d+/)?.[0] || '0');
  const row = tile.match(/[A-I]/)?.[0] || 'A';
  return (row.charCodeAt(0) - 65) * 100 + num;
};

/**
 * Get Stock Price
 * Calculates asset value based on the official pricing matrix.
 */
const getStockPrice = (corp: string, size: number) => {
  const s = size < 2 ? 2 : size;
  let base = 0;
  if (['Sackson', 'Tower'].includes(corp)) base = 200;
  else if (['Festival', 'Worldwide', 'American'].includes(corp)) base = 300;
  else if (['Imperial', 'Continental'].includes(corp)) base = 400;

  let bonus = 0;
  if (s === 3) bonus = 100;
  else if (s === 4) bonus = 200;
  else if (s === 5) bonus = 300;
  else if (s >= 6 && s <= 10) bonus = 400;
  else if (s >= 11 && s <= 20) bonus = 500;
  else if (s >= 21 && s <= 30) bonus = 600;
  else if (s >= 31 && s <= 40) bonus = 700;
  else if (s >= 41) bonus = 800;
  
  return base + bonus;
};

// --- PRIMARY COMPONENT LOGIC ---

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [mobileTab, setMobileTab] = useState<'board' | 'market'>('board');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);

  const [sellCount, setSellCount] = useState(0);
  const [tradePairs, setTradePairs] = useState(0);
  const autoSkipRef = useRef<string | null>(null);
  
  // Protocol UI State
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [ruleSearchTerm, setRuleSearchTerm] = useState('');
  const [isMyTurnAlert, setIsMyTurnAlert] = useState(false);
  const prevTurnRef = useRef<number | null>(null);

  // Terminal Shutdown Timer
  const [shutdownCountdown, setShutdownCountdown] = useState(10);

  // --- FAILSAFE ENGINE STATE ---
  const [reconnectSeconds, setReconnectSeconds] = useState(300);
  const [isReentering, setIsReentering] = useState(false);
  const [resumeCountdown, setResumeCountdown] = useState<number | null>(null);

  // --- SPECTATOR EVACUATION STATE ---
  const [isLeaveLoungeModalOpen, setIsLeaveLoungeModalOpen] = useState(false);

  // --- NEW: LEADERSHIP UI STATE ---
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  
  // --- NEW: WINNER'S TABLE STATE ---
  const [isWinnersTableOpen, setIsWinnersTableOpen] = useState(false);

  const peerInstance = useRef<Peer | null>(null);

  // --- OPERATIVE LOCAL IDENTITY (THE "ME" FIX) ---
  // Memoizing 'me' ensures we have a stable, non-stale reference to the local user.
  const me = useMemo(() => {
    return players.find(p => p.player_name === playerName);
  }, [players, playerName]);

  // Sync isHost state locally based on DB record
  useEffect(() => {
    if (me) setIsHost(me.is_host);
  }, [me?.is_host]);

  // --- HEARTBEAT PULSE ENGINE ---
  useEffect(() => {
    // We only ping if the operative is fully authenticated and in a lobby.
    if (!me?.id || !lobbyInfo?.id) return;
    
    const interval = setInterval(async () => {
      await supabase
        .from('players')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', me.id);
    }, 5000); // 5-second frequency
    
    return () => clearInterval(interval);
  }, [me?.id, lobbyInfo?.id]);

  // --- TACTICAL LOCKDOWN MONITOR & AUTO-MIGRATION ---
  useEffect(() => {
    if (!lobbyInfo || lobbyInfo.status !== 'playing') return;
    
    const activeOperatives = players.filter(p => !p.is_spectator);
    const hostOp = players.find(p => p.is_host);
    const now = new Date().getTime();
    
    // Scan for operatives who have failed to pulse within the 15s window.
    const dcPlayers = activeOperatives.filter(p => {
      const lastSeen = new Date(p.last_seen || 0).getTime();
      return (now - lastSeen) > 15000;
    });

    // Specific Host Connectivity Check
    const isHostMissing = hostOp && (now - new Date(hostOp.last_seen || 0).getTime()) > 15000;

    if (dcPlayers.length > 0 && !lobbyInfo.is_paused) {
      // Initiate Lockdown: Freeze all board and market interactions.
      // If HOST is missing, trigger 2-minute timer (120s). Otherwise 5-minutes (300s).
      const windowSeconds = isHostMissing ? 120 : 300;
      const expiry = new Date(now + (windowSeconds * 1000)).toISOString();
      
      supabase.from('lobbies').update({ 
        is_paused: true, 
        reconnect_timer: expiry,
        host_transfer_data: isHostMissing ? { ...lobbyInfo.host_transfer_data, isAutoMigration: true } : lobbyInfo.host_transfer_data
      }).eq('id', lobbyInfo.id);
    } else if (dcPlayers.length === 0 && lobbyInfo.is_paused) {
      // Reconnaissance Successful: Roster is whole.
      handleResumeStabilization();
    }
  }, [players, lobbyInfo?.is_paused, lobbyInfo?.status, lobbyInfo?.id]);

  /**
   * Handle Resume Stabilization
   * Provides a 3-second buffer before lifting the tactical lockdown.
   */
  const handleResumeStabilization = async () => {
    setResumeCountdown(3);
    const timer = setInterval(() => {
      setResumeCountdown(prev => {
        if (prev && prev <= 1) {
          clearInterval(timer);
          if (lobbyInfo?.id) {
            supabase.from('lobbies').update({ 
              is_paused: false, 
              reconnect_timer: null 
            }).eq('id', lobbyInfo.id);
          }
          return null;
        }
        return prev ? prev - 1 : null;
      });
    }, 1000);
  };

  // --- EXTRACTION WINDOW ENGINE & MIGRATION TRIGGER ---
  useEffect(() => {
    if (lobbyInfo?.reconnect_timer) {
      const timer = setInterval(() => {
        const currentTime = new Date().getTime();
        const expiryTime = new Date(lobbyInfo.reconnect_timer!).getTime();
        const remaining = Math.max(0, Math.floor((expiryTime - currentTime) / 1000));
        
        setReconnectSeconds(remaining);
        
        // Critical: If extraction window reaches zero, determine path.
        if (remaining === 0 && lobbyInfo.status !== 'finished' && lobbyInfo.status !== 'waiting') {
           // If the lockdown was caused by host loss, trigger re-assignment instead of liquidation
           if (lobbyInfo.host_transfer_data?.isAutoMigration) {
             handleExecuteAutoMigration();
           } else {
             handleEndGame(); 
           }
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [lobbyInfo?.reconnect_timer, lobbyInfo?.status, lobbyInfo?.host_transfer_data?.isAutoMigration]);

  // --- RE-ENTRY RECOGNITION ENGINE ---
  useEffect(() => {
    if (joinCodeInput.length === 6 && playerName) {
      const checkOperativeStatus = async () => {
        const { data: currentLobby } = await supabase
          .from('lobbies')
          .select('id, status')
          .eq('join_code', joinCodeInput.toUpperCase())
          .single();
          
        if (currentLobby && currentLobby.status === 'playing') {
          const { data: existingOp } = await supabase
            .from('players')
            .select('id')
            .eq('lobby_id', currentLobby.id)
            .eq('player_name', playerName)
            .single();
            
          setIsReentering(!!existingOp);
        }
      };
      checkOperativeStatus();
    }
  }, [joinCodeInput, playerName]);

  // --- CORE REALTIME SYNC ENGINE ---
  useEffect(() => {
    if (!lobbyInfo?.id) return;

    const synchronizeData = async () => {
      const { data: pList } = await supabase
        .from('players')
        .select('*')
        .eq('lobby_id', lobbyInfo.id)
        .order('play_order', { ascending: true, nullsFirst: false });
      
      const { data: lState } = await supabase
        .from('lobbies')
        .select('*')
        .eq('id', lobbyInfo.id)
        .single();
        
      if (pList) setPlayers(pList as Player[]);
      if (lState) {
        setLobbyInfo(lState as Lobby);
        // Automatically trigger Winners Table if game just finished
        if (lState.status === 'finished') setIsWinnersTableOpen(true);
      }
    };

    synchronizeData();

    // Establishing duplex channel for terminal updates.
    const syncChannel = supabase.channel(`terminal-sync-${lobbyInfo.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, () => synchronizeData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` }, () => synchronizeData())
      .subscribe();

    return () => { supabase.removeChannel(syncChannel); };
  }, [lobbyInfo?.id]);

  // --- TURN NOTIFICATION ENGINE ---
  useEffect(() => {
    // Only proceed if operative is authenticated and the grid is not in lockdown.
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    if (lobbyInfo.status === 'playing') {
      const isNewTurn = prevTurnRef.current !== lobbyInfo.current_turn_index;
      
      if (isNewTurn) {
        if (!me.is_spectator && lobbyInfo.current_turn_index === me.play_order) {
          setTimeout(() => {
              playTerminalPing();
              setIsMyTurnAlert(true);
              setTimeout(() => setIsMyTurnAlert(false), 3000); 
          }, prevTurnRef.current === null ? 500 : 0);
        }
      }
      prevTurnRef.current = lobbyInfo.current_turn_index;
    }
  }, [lobbyInfo?.current_turn_index, lobbyInfo?.status, me, lobbyInfo?.is_paused]);

  // --- SHUTDOWN SEQUENCE LOGIC ---
  useEffect(() => {
    if (lobbyInfo?.end_session_data?.phase === 'countdown' && me?.is_host) {
      const shutdownTimer = setInterval(() => {
        setShutdownCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(shutdownTimer);
            handleConfirmEndLobby();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(shutdownTimer);
    } else {
      setShutdownCountdown(10);
    }
  }, [lobbyInfo?.end_session_data?.phase, me?.is_host]);

  // --- SECURE COMMS ENGINE (WEBRTC) ---
  useEffect(() => {
    if (!me?.id || typeof window === 'undefined') return;
    
    const peerId = me.id.replace(/-/g, '');
    const peer = new Peer(peerId);
    peerInstance.current = peer;
    
    peer.on('call', (incomingCall) => {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        incomingCall.answer(stream);
        incomingCall.on('stream', (remoteStream) => { 
          const audio = new Audio(); 
          audio.srcObject = remoteStream; 
          audio.play(); 
        });
      });
    });
    
    return () => peer.destroy();
  }, [me?.id]);

  /**
   * Toggle Voice Comms
   * Broadcaster for the encrypted audio link.
   */
  const toggleVoice = async () => {
    if (isMicActive) { 
      peerInstance.current?.destroy(); 
      setIsMicActive(false); 
      return; 
    }
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsMicActive(true);
      
      // Dialing all other operatives in the session.
      players.filter(p => p.id !== me?.id).forEach(targetPlayer => {
        const targetPeerId = targetPlayer.id.replace(/-/g, '');
        const outgoingCall = peerInstance.current?.call(targetPeerId, localStream);
        
        outgoingCall?.on('stream', (remoteStream) => { 
          const audio = new Audio(); 
          audio.srcObject = remoteStream; 
          audio.play(); 
        });
      });
    } catch (err) { 
      alert("Comms Protocol Failure: Hardware access denied."); 
    }
  };

  // --- AUTO-SKIP ENGINE ---
  useEffect(() => {
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    if (lobbyInfo.turn_phase === 'merger_resolution' && players[lobbyInfo.disposition_turn_index]?.id === me.id) {
      const currentDefunct = lobbyInfo.merger_data.current_defunct;
      
      if (currentDefunct && (me.stocks[currentDefunct] || 0) === 0) {
        const turnKey = `skip-${lobbyInfo.id}-${currentDefunct}-${lobbyInfo.disposition_turn_index}`;
        if (autoSkipRef.current !== turnKey) {
          autoSkipRef.current = turnKey;
          handleDisposition(0, 0); 
        }
      }
    }
  }, [lobbyInfo?.turn_phase, lobbyInfo?.disposition_turn_index, lobbyInfo?.merger_data.current_defunct, lobbyInfo?.is_paused, me, players]);

  // --- NEW: COMMAND HIERARCHY LOGIC (HOST TRANSFER) ---

  /**
   * handleInitiateHostTransfer
   * Starts the handshake process for leadership reassignment.
   */
  const handleInitiateHostTransfer = async (targetId: string) => {
    if (!lobbyInfo || !me?.is_host) return;
    await supabase.from('lobbies').update({
      host_transfer_data: {
        ...lobbyInfo.host_transfer_data,
        targetId: targetId,
        status: 'pending'
      }
    }).eq('id', lobbyInfo.id);
    setIsTransferModalOpen(false);
  };

  /**
   * handleResponseHostTransfer
   * Finalizes or rejects the leadership handshake.
   */
  const handleResponseHostTransfer = async (accept: boolean) => {
    if (!lobbyInfo || !me) return;
    
    if (accept) {
      // Step 1: Strip host from old operative
      const oldHost = players.find(p => p.is_host);
      if (oldHost) await supabase.from('players').update({ is_host: false }).eq('id', oldHost.id);
      
      // Step 2: Elevate current operative
      await supabase.from('players').update({ is_host: true }).eq('id', me.id);
      
      // Step 3: Clear the handshake state
      await supabase.from('lobbies').update({
        host_transfer_data: { targetId: null, rejectedIds: [], status: 'none', isAutoMigration: false }
      }).eq('id', lobbyInfo.id);
    } else {
      // Rejection: Record ID and reset status
      const rejected = Array.from(new Set([...(lobbyInfo.host_transfer_data?.rejectedIds || []), me.id]));
      await supabase.from('lobbies').update({
        host_transfer_data: { ...lobbyInfo.host_transfer_data, targetId: null, status: 'none', rejectedIds: rejected }
      }).eq('id', lobbyInfo.id);
    }
  };

  /**
   * handleExecuteAutoMigration
   * Automatic succession logic if the primary link is lost for 120s.
   */
  const handleExecuteAutoMigration = async () => {
    if (!lobbyInfo) return;
    const currentHost = players.find(p => p.is_host);
    const potentialLeaders = players.filter(p => !p.is_spectator && p.id !== currentHost?.id);
    
    if (potentialLeaders.length > 0) {
      const nextLeader = potentialLeaders[0];
      if (currentHost) await supabase.from('players').update({ is_host: false }).eq('id', currentHost.id);
      await supabase.from('players').update({ is_host: true }).eq('id', nextLeader.id);
      
      // Resuming mission under new leadership
      await supabase.from('lobbies').update({ 
        is_paused: false, 
        reconnect_timer: null,
        host_transfer_data: { targetId: null, rejectedIds: [], status: 'none', isAutoMigration: false }
      }).eq('id', lobbyInfo.id);
    } else {
      // Zero active backups: Liquidate session.
      handleEndGame(); 
    }
  };

  // --- MERGER ENGINE CALCULATIONS ---

  /**
   * Distribute Merger Bonuses
   * Logic for Primary and Secondary payouts during corporate liquidation.
   */
  const distributeBonuses = async (corp: string, size: number) => {
    const assetPrice = getStockPrice(corp, size);
    const primaryBonus = assetPrice * 10;
    const secondaryBonus = assetPrice * 5;
    
    const activeVoters = players.filter(p => !p.is_spectator);
    const rankedBoard = [...activeVoters].sort((a, b) => (b.stocks[corp] || 0) - (a.stocks[corp] || 0));
    
    const holdings = rankedBoard.map(p => p.stocks[corp] || 0);
    if (holdings[0] === 0) return;

    const primaryShareholders = rankedBoard.filter(p => (p.stocks[corp] || 0) === holdings[0]);
    
    if (primaryShareholders.length > 1) {
      // Tie for Primary: Combined bonuses split evenly.
      let splitVal = (primaryBonus + secondaryBonus) / primaryShareholders.length;
      splitVal = Math.ceil(splitVal / 100) * 100; 
      
      for (const operative of primaryShareholders) {
        await supabase.from('players').update({ money: operative.money + splitVal }).eq('id', operative.id);
      }
    } else {
      // Single Primary: Payout confirmed.
      await supabase.from('players').update({ money: primaryShareholders[0].money + primaryBonus }).eq('id', primaryShareholders[0].id);
      
      const secondMaxHold = holdings.find(count => count < holdings[0] && count > 0);
      const secondaryShareholders = rankedBoard.filter(p => (p.stocks[corp] || 0) === secondMaxHold);
      
      if (secondaryShareholders.length > 0) {
        // Tie for Secondary: Secondary bonus split.
        let secondarySplit = secondaryBonus / secondaryShareholders.length;
        secondarySplit = Math.ceil(secondarySplit / 100) * 100; 
        
        for (const operative of secondaryShareholders) {
          await supabase.from('players').update({ money: operative.money + secondarySplit }).eq('id', operative.id);
        }
      } else { 
        // No secondary owner: Primary takes both bonuses.
        await supabase.from('players').update({ money: primaryShareholders[0].money + secondaryBonus }).eq('id', primaryShareholders[0].id); 
      }
    }
  };

  // --- MISSION CRITICAL ACTIONS ---

  /**
   * Handle Place Tile
   * Updates grid state and determines if a founding or merger is triggered.
   */
  const handlePlaceTile = async (tile: string) => {
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    const colValue = parseInt(tile.match(/\d+/)?.[0] || '0');
    const rowChar = tile.match(/[A-I]/)?.[0] || 'A';
    
    const adjacentPositions = [
      `${colValue - 1}${rowChar}`, `${colValue + 1}${rowChar}`, 
      `${colValue}${String.fromCharCode(rowChar.charCodeAt(0) - 1)}`, 
      `${colValue}${String.fromCharCode(rowChar.charCodeAt(0) + 1)}`
    ].filter(pos => {
      const c = parseInt(pos.match(/\d+/)?.[0] || '0');
      const r = pos.match(/[A-I]/)?.[0] || '';
      return c >= 1 && c <= 12 && r >= 'A' && r <= 'I' && lobbyInfo.board_state.includes(pos);
    });

    const adjacentSyndicates = Array.from(new Set(adjacentPositions.map(pos => lobbyInfo.tile_ownership[pos]).filter((c): c is string => !!c)));
    
    let targetPhase = 'buy_stocks';
    let dataForMerger: MergerData = {};

    if (adjacentSyndicates.length > 1) {
      // Hostile Acquisition sequence triggered.
      targetPhase = 'merger_resolution';
      const sortedByWeight = [...adjacentSyndicates].sort((a, b) => (lobbyInfo.chain_sizes[b] || 0) - (lobbyInfo.chain_sizes[a] || 0));
      const leadSyndicate = sortedByWeight[0];
      const defunctSyndicates = sortedByWeight.slice(1);
      
      await distributeBonuses(defunctSyndicates[0], lobbyInfo.chain_sizes[defunctSyndicates[0]]);
      dataForMerger = { survivor: leadSyndicate, current_defunct: defunctSyndicates[0], defunct_corps: defunctSyndicates, tile_placed: tile };
    } 
    else if (adjacentSyndicates.length === 1) {
      // Syndicate Growth sequence.
      const dominatingSyndicate = adjacentSyndicates[0];
      const unassignedTiles = adjacentPositions.filter(pos => !lobbyInfo.tile_ownership[pos]);
      const updatedMapping = { ...lobbyInfo.tile_ownership, [tile]: dominatingSyndicate };
      unassignedTiles.forEach(t => { updatedMapping[t] = dominatingSyndicate; });
      
      await supabase.from('lobbies').update({ 
        chain_sizes: { ...lobbyInfo.chain_sizes, [dominatingSyndicate]: (lobbyInfo.chain_sizes[dominatingSyndicate] || 0) + 1 + unassignedTiles.length },
        tile_ownership: updatedMapping 
      }).eq('id', lobbyInfo.id);
    }
    else if (adjacentSyndicates.length === 0 && adjacentPositions.length > 0 && lobbyInfo.active_chains.length < 7) {
      // Founding sequence.
      targetPhase = 'found_chain';
    }

    // Update operative hand and lobby state.
    await supabase.from('players').update({ hand: me.hand.filter(t => t !== tile) }).eq('id', me.id);
    await supabase.from('lobbies').update({ 
      board_state: [...lobbyInfo.board_state, tile], 
      turn_phase: targetPhase, 
      merger_data: dataForMerger, 
      disposition_turn_index: lobbyInfo.current_turn_index 
    }).eq('id', lobbyInfo.id);
  };

  /**
   * Handle Found Chain
   * Registers a new corporation on the grid and assigns a founder's bonus.
   */
  const handleFoundChain = async (syndicate: string) => {
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    const adjustedStocks = { ...(me.stocks || {}), [syndicate]: ((me.stocks || {})[syndicate] || 0) + 1 };
    const referenceTile = lobbyInfo.board_state[lobbyInfo.board_state.length - 1];
    const colVal = parseInt(referenceTile.match(/\d+/)?.[0] || '0');
    const rowVal = referenceTile.match(/[A-I]/)?.[0] || 'A';
    
    const surroundingCluster = [
      `${colVal - 1}${rowVal}`, `${colVal + 1}${rowVal}`, 
      `${colVal}${String.fromCharCode(rowVal.charCodeAt(0) - 1)}`, 
      `${colVal}${String.fromCharCode(rowVal.charCodeAt(0) + 1)}`
    ].filter(pos => {
      const c = parseInt(pos.match(/\d+/)?.[0] || '0');
      const r = pos.match(/[A-I]/)?.[0] || '';
      return c >= 1 && c <= 12 && r >= 'A' && r <= 'I' && lobbyInfo.board_state.includes(pos) && !lobbyInfo.tile_ownership[pos];
    });
    
    const updatedOwnershipMap = { ...lobbyInfo.tile_ownership };
    [referenceTile, ...surroundingCluster].forEach(t => { updatedOwnershipMap[t] = syndicate; });

    await supabase.from('players').update({ stocks: adjustedStocks }).eq('id', me.id);
    await supabase.from('lobbies').update({ 
      active_chains: [...lobbyInfo.active_chains, syndicate], 
      chain_sizes: { ...lobbyInfo.chain_sizes, [syndicate]: surroundingCluster.length + 1 }, 
      tile_ownership: updatedOwnershipMap, 
      available_stocks: { ...lobbyInfo.available_stocks, [syndicate]: (lobbyInfo.available_stocks[syndicate] || 25) - 1 }, 
      turn_phase: 'buy_stocks' 
    }).eq('id', lobbyInfo.id);
  };

  /**
   * Handle Buy Stock
   * Liquidates operative cash in exchange for syndicate shares.
   */
  const handleBuyStock = async (syndicate: string) => {
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    const sharePrice = getStockPrice(syndicate, lobbyInfo.chain_sizes[syndicate] || 0);
    const vaultQuantity = lobbyInfo.available_stocks[syndicate] || 0;
    
    if (me.money < sharePrice || stocksBoughtThisTurn >= 3 || vaultQuantity <= 0) return;
    
    const newStockManifest = { ...(me.stocks || {}), [syndicate]: ((me.stocks || {})[syndicate] || 0) + 1 };
    setStocksBoughtThisTurn(prevCount => prevCount + 1);
    
    await supabase.from('players').update({ 
      money: me.money - sharePrice, 
      stocks: newStockManifest 
    }).eq('id', me.id);
    
    await supabase.from('lobbies').update({ 
      available_stocks: { ...lobbyInfo.available_stocks, [syndicate]: vaultQuantity - 1 } 
    }).eq('id', lobbyInfo.id);
  };

  /**
   * Handle Disposition
   * Declarative logic for selling, trading, or keeping defunct shares.
   */
  const handleDisposition = async (sellQty: number, tradeSets: number) => {
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    const { survivor, current_defunct, defunct_corps, tile_placed } = lobbyInfo.merger_data;
    
    let liquidity = me.money;
    let portfolio = { ...me.stocks };

    if (sellQty > 0) {
      liquidity += sellQty * getStockPrice(current_defunct!, lobbyInfo.chain_sizes[current_defunct!]);
    }
    
    portfolio[current_defunct!] -= (sellQty + (tradeSets * 2));
    if (tradeSets > 0) {
      portfolio[survivor!] = (portfolio[survivor!] || 0) + tradeSets;
    }

    let bankInventory = { ...lobbyInfo.available_stocks };
    bankInventory[current_defunct!] = (bankInventory[current_defunct!] || 0) + sellQty + (tradeSets * 2);
    bankInventory[survivor!] = Math.max(0, (bankInventory[survivor!] || 0) - tradeSets);

    const operatives = players.filter(p => !p.is_spectator);
    const nextDispositionIndex = (lobbyInfo.disposition_turn_index + 1) % operatives.length;

    setSellCount(0);
    setTradePairs(0);

    let lobbyTransmission: any = {
      disposition_turn_index: nextDispositionIndex,
      available_stocks: bankInventory
    };

    // Check if full rotation of disposition is complete.
    if (nextDispositionIndex === lobbyInfo.current_turn_index) {
      const globalOwnership = { ...lobbyInfo.tile_ownership };
      Object.keys(globalOwnership).forEach(key => {
        if (globalOwnership[key] === current_defunct) globalOwnership[key] = survivor!;
      });
      
      const pendingDefuncts = defunct_corps?.filter(c => c !== current_defunct) || [];
      
      if (pendingDefuncts.length > 0) {
        // Multi-syndicate merger resolution: Move to next defunct chain.
        await distributeBonuses(pendingDefuncts[0], lobbyInfo.chain_sizes[pendingDefuncts[0]]);
        lobbyTransmission = {
          ...lobbyTransmission,
          merger_data: { ...lobbyInfo.merger_data, current_defunct: pendingDefuncts[0], defunct_corps: pendingDefuncts },
          disposition_turn_index: lobbyInfo.current_turn_index,
          tile_ownership: globalOwnership,
          active_chains: lobbyInfo.active_chains.filter(c => c !== current_defunct),
          chain_sizes: {
            ...lobbyInfo.chain_sizes,
            [survivor!]: (lobbyInfo.chain_sizes[survivor!] || 0) + (lobbyInfo.chain_sizes[current_defunct!] || 0)
          }
        };
      } else {
        // Merger finalized. Returning to standard sequence.
        globalOwnership[tile_placed!] = survivor!;
        lobbyTransmission = {
          ...lobbyTransmission,
          turn_phase: 'buy_stocks',
          tile_ownership: globalOwnership,
          active_chains: lobbyInfo.active_chains.filter(c => c !== current_defunct),
          chain_sizes: {
            ...lobbyInfo.chain_sizes,
            [survivor!]: (lobbyInfo.chain_sizes[survivor!] || 0) + (lobbyInfo.chain_sizes[current_defunct!] || 0) + 1
          }
        };
      }
    }
    
    await supabase.from('players').update({ money: liquidity, stocks: portfolio }).eq('id', me.id);
    await supabase.from('lobbies').update(lobbyTransmission).eq('id', lobbyInfo.id);
  };

  /**
   * Handle End Turn
   * Cycles the turn index and replenishes the operative's tactical hand.
   */
  const handleEndTurn = async () => {
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    const vault = [...lobbyInfo.tile_pool];
    const tacticalHand = [...me.hand];
    
    if (vault.length > 0) {
      tacticalHand.push(vault.pop()!);
    }
    
    setStocksBoughtThisTurn(0);
    
    const activeOperatives = players.filter(p => !p.is_spectator);
    await supabase.from('players').update({ hand: tacticalHand }).eq('id', me.id);
    await supabase.from('lobbies').update({
      tile_pool: vault,
      current_turn_index: (lobbyInfo.current_turn_index + 1) % activeOperatives.length,
      turn_phase: 'place_tile'
    }).eq('id', lobbyInfo.id);
  };

  /**
   * Handle Swap Tile
   * Replaces a permanently unplayable tile with a fresh asset from the vault.
   */
  const handleSwapTile = async (tile: string) => {
    if (!lobbyInfo || !me || lobbyInfo.is_paused) return;
    
    const vault = [...lobbyInfo.tile_pool];
    if (vault.length === 0) return;
    
    const newAsset = vault.pop();
    const updatedHand = me.hand.filter(t => t !== tile);
    if (newAsset) updatedHand.push(newAsset);
    
    await supabase.from('players').update({ hand: updatedHand }).eq('id', me.id);
    await supabase.from('lobbies').update({ tile_pool: vault }).eq('id', lobbyInfo.id);
  };

  /**
   * Handle End Game
   * Performs final asset valuation and mission stand-down.
   */
  const handleEndGame = async () => {
    if (!lobbyInfo) return;
    
    // Distributing final bonuses for all active syndicates.
    for (const syndicate of lobbyInfo.active_chains) {
      await distributeBonuses(syndicate, lobbyInfo.chain_sizes[syndicate]);
    }
    
    const { data: finalOperativeList } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id);
    if (!finalOperativeList) return;
    
    for (const operative of finalOperativeList) {
      let liquidationCash = operative.money;
      CORPORATIONS.forEach(corp => {
        if (operative.stocks[corp] > 0) {
          liquidationCash += operative.stocks[corp] * getStockPrice(corp, lobbyInfo.chain_sizes[corp]);
        }
      });
      
      await supabase.from('players').update({ 
        money: liquidationCash, 
        stocks: {}, 
        wants_to_swap: false, 
        wants_restart: false 
      }).eq('id', operative.id);
    }
    
    await supabase.from('lobbies').update({ 
      status: 'finished', 
      end_session_data: {},
      is_paused: false,
      reconnect_timer: null
    }).eq('id', lobbyInfo.id);
    
    setIsWinnersTableOpen(true);
  };

  /**
   * Handle Restart Vote
   * Operative signaling for a hard-reset.
   */
  const handleRestartVote = async () => {
    if (!me?.id) return;
    await supabase.from('players').update({ wants_restart: true }).eq('id', me.id);
  };

  // Monitoring consensus for mission restart.
  useEffect(() => {
    const activeOps = players.filter(p => !p.is_spectator);
    if (activeOps.length > 0 && activeOps.every(p => p.wants_restart)) {
      handleStartGame();
    }
  }, [players]);

  /**
   * Handle Start Game
   * Deploys the grid, draws starting assets, and establishes turn order.
   */
  const handleStartGame = async () => {
    if (!lobbyInfo) return;
    const activeOps = players.filter(p => !p.is_spectator);
    
    let gridManifest: string[] = [];
    for (const r of BOARD_ROWS) {
      for (const c of BOARD_COLS) {
        gridManifest.push(`${c}${r}`);
      }
    }

    let initialDraw: { id: string, tile: string }[] = [];
    let deploymentValid = false;

    // Tactical Check: Ensure no two starting tiles are adjacent.
    while (!deploymentValid) {
      gridManifest = gridManifest.sort(() => Math.random() - 0.5);
      const tempVault = [...gridManifest];
      initialDraw = activeOps.map(op => ({ id: op.id, tile: tempVault.pop()! }));

      let adjacencyDetected = false;
      for (let i = 0; i < initialDraw.length; i++) {
        const t1 = initialDraw[i].tile;
        const c1 = parseInt(t1.match(/\d+/)?.[0] || '0');
        const r1 = t1.match(/[A-I]/)?.[0] || 'A';

        for (let j = i + 1; j < initialDraw.length; j++) {
          const t2 = initialDraw[j].tile;
          const c2 = parseInt(t2.match(/\d+/)?.[0] || '0');
          const r2 = t2.match(/[A-I]/)?.[0] || 'A';
          const isAdj = (c1 === c2 && Math.abs(r1.charCodeAt(0) - r2.charCodeAt(0)) === 1) || (r1 === r2 && Math.abs(c1 - c2) === 1);
          if (isAdj) { adjacencyDetected = true; break; }
        }
        if (adjacencyDetected) break;
      }
      
      if (!adjacencyDetected) {
        deploymentValid = true;
        gridManifest = tempVault;
      }
    }

    // Sort draw to establish operative priority.
    initialDraw.sort((a, b) => getTileValue(a.tile) - getTileValue(b.tile));
    for (let i = 0; i < initialDraw.length; i++) {
      await supabase.from('players').update({
        play_order: i,
        starting_tile: initialDraw[i].tile,
        hand: gridManifest.splice(-6),
        wants_to_swap: false,
        wants_restart: false
      }).eq('id', initialDraw[i].id);
    }

    await supabase.from('lobbies').update({
      status: 'playing',
      board_state: initialDraw.map(draw => draw.tile),
      tile_pool: gridManifest,
      end_session_data: {},
      is_paused: false
    }).eq('id', lobbyInfo.id);
  };

  /**
   * Handle Join Lobby
   * Frequency synchronization for new or returning operatives.
   */
  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName || !joinCodeInput) return;
    
    const { data: targetLobby } = await supabase
      .from('lobbies')
      .select('*')
      .eq('join_code', joinCodeInput.toUpperCase())
      .single();

    if (targetLobby) {
      const { data: currentRoster } = await supabase
        .from('players')
        .select('*')
        .eq('lobby_id', targetLobby.id);
      
      // Recognition check for returning link (Case-insensitive)
      const legacyEntry = currentRoster?.find(p => 
        p.player_name.trim().toLowerCase() === playerName.trim().toLowerCase()
      );

      if (legacyEntry) {
        // Operative found in roster. Re-establishing link...
        setLobbyInfo(targetLobby as Lobby);
        return;
      }

      // New operative registration logic
      const activeCt = currentRoster?.filter(p => !p.is_spectator).length || 0;
      const started = targetLobby.status !== 'waiting';
      const shouldSpectate = activeCt >= 6 || started;

      const { error } = await supabase.from('players').insert([{
        lobby_id: targetLobby.id,
        player_name: playerName.trim(),
        is_host: false,
        is_spectator: shouldSpectate,
        money: shouldSpectate ? 0 : 6000, 
        stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}),
        hand: [],
        wants_to_swap: false,
        last_seen: new Date().toISOString()
      }]);
      
      if (!error) {
        setLobbyInfo(targetLobby as Lobby);
      } else {
        alert("Encryption Protocol Error: Authorization denied.");
      }
    } else {
      alert("Invalid Frequency: Lobby not found.");
    }
  };

  /**
   * Handle Create Lobby
   * Encrypts and registers a new tactical environment.
   */
  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName) return;
    
    const hexCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Step 1: Initialize the Lobby in the DB
    const { data: newLobby, error: lobbyError } = await supabase.from('lobbies').insert([{
      join_code: hexCode,
      status: 'waiting',
      turn_phase: 'place_tile',
      current_turn_index: 0,
      board_state: [],
      active_chains: [],
      chain_sizes: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}),
      tile_ownership: {},
      available_stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 25 }), {}),
      tile_pool: [],
      end_session_data: {},
      host_transfer_data: { targetId: null, rejectedIds: [], status: 'none', isAutoMigration: false }
    }]).select().single();
    
    if (newLobby && !lobbyError) {
      // Step 2: Insert the Host as the first Operative
      const { error: playerError } = await supabase.from('players').insert([{
        lobby_id: newLobby.id,
        player_name: playerName.trim(),
        is_host: true,
        is_spectator: false,
        money: 6000,
        stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}),
        hand: [],
        wants_to_swap: false,
        last_seen: new Date().toISOString() // Prime heartbeat pulse
      }]);

      if (!playerError) {
        setLobbyInfo(newLobby as Lobby);
        setIsHost(true);
      } else {
        console.error("Critical Failure: Commander profile could not be written.", playerError);
      }
    } else {
      console.error("Critical Failure: Sector initialization failed.", lobbyError);
    }
  };

  /**
   * Get Tile Legality
   * Real-time grid validation for asset placement.
   */
  const getTileLegality = (tile: string) => {
    if (!lobbyInfo) return 'valid';
    
    const colVal = parseInt(tile.match(/\d+/)?.[0] || '0');
    const rowChar = tile.match(/[A-I]/)?.[0] || 'A';
    
    const adjPositions = [
      `${colVal - 1}${rowChar}`, `${colVal + 1}${rowChar}`, 
      `${colVal}${String.fromCharCode(rowChar.charCodeAt(0) - 1)}`, 
      `${colVal}${String.fromCharCode(rowChar.charCodeAt(0) + 1)}`
    ].filter(pos => {
      const c = parseInt(pos.match(/\d+/)?.[0] || '0');
      const r = pos.match(/[A-I]/)?.[0] || '';
      return c >= 1 && c <= 12 && r >= 'A' && r <= 'I' && lobbyInfo.board_state.includes(pos);
    });

    const adjSyndicates = Array.from(new Set(adjPositions.map(pos => lobbyInfo.tile_ownership[pos]).filter((c): c is string => !!c)));
    const safeSyndicates = adjSyndicates.filter(c => (lobbyInfo.chain_sizes[c] || 0) >= 11);
    
    // Violation 1: Merging two safe syndicates.
    if (safeSyndicates.length >= 2) return 'permanently_unplayable';
    
    // Violation 2: Founding an 8th syndicate.
    if (adjSyndicates.length === 0 && adjPositions.length > 0 && lobbyInfo.active_chains.length >= 7) return 'temporarily_unplayable';
    
    return 'valid';
  };

  // --- ROSTER ADJUSTMENT ENGINE ---

  const handleRequestSwap = async () => {
    if (!me?.id || me.is_spectator) return;
    await supabase.from('players').update({ wants_to_swap: true }).eq('id', me.id);
  };

  const handleAcceptSwap = async (activeOpId: string) => {
    if (!me?.id || !me.is_spectator) return;
    
    await supabase.from('players').update({ 
      is_spectator: true, 
      wants_to_swap: false 
    }).eq('id', activeOpId);
    
    await supabase.from('players').update({ 
      is_spectator: false,
      money: 6000 
    }).eq('id', me.id);
  };

  // --- TERMINATION PROTOCOLS ---

  const handleInitiateEndLobby = async () => {
    if (!lobbyInfo?.id || !me?.is_host) return;
    await supabase.from('lobbies').update({ 
      end_session_data: { phase: 'voting', yesVotes: [], noVotes: [] } 
    }).eq('id', lobbyInfo.id);
  };

  const handleVoteEndLobby = async (vote: 'yes' | 'no') => {
    if (!lobbyInfo?.id || !me?.id) return;
    
    const data = lobbyInfo.end_session_data || {};
    const yesManifest = data.yesVotes || [];
    const noManifest = data.noVotes || [];
    
    if (vote === 'yes' && !yesManifest.includes(me.id)) yesManifest.push(me.id);
    if (vote === 'no' && !noManifest.includes(me.id)) noManifest.push(me.id);

    const votersReq = players.filter(p => !p.is_spectator && !p.is_host).length;

    if (noManifest.length > 0) {
      await supabase.from('lobbies').update({ end_session_data: {} }).eq('id', lobbyInfo.id);
    } else if (yesManifest.length >= votersReq) {
      await supabase.from('lobbies').update({ 
        end_session_data: { phase: 'countdown' } 
      }).eq('id', lobbyInfo.id);
    } else {
      await supabase.from('lobbies').update({ 
        end_session_data: { phase: 'voting', yesVotes: yesManifest, noVotes: noManifest } 
      }).eq('id', lobbyInfo.id);
    }
  };

  const handleConfirmEndLobby = async () => {
    if (!lobbyInfo?.id) return;
    await supabase.from('lobbies').update({ status: 'terminated' }).eq('id', lobbyInfo.id);
  };

  const handleRetractEndLobby = async () => {
    if (!lobbyInfo?.id) return;
    await supabase.from('lobbies').update({ end_session_data: {} }).eq('id', lobbyInfo.id);
  };

  // --- NEW: SPECTATOR EVACUATION LOGIC (LEAVE LOUNGE) ---

  /**
   * handleExecuteLoungeExit
   * Permanently deletes the operative record and resets the local terminal.
   */
  const handleExecuteLoungeExit = async () => {
    if (!me?.id || !lobbyInfo?.id) return;
    
    // Purge record from Supabase
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', me.id);
      
    if (!error) {
      // Hard reset local state to home view
      setLobbyInfo(null);
      setView('home');
      setIsLeaveLoungeModalOpen(false);
      
      // Optional: Clear Peer instance to free hardware
      peerInstance.current?.destroy();
    } else {
      alert("Extraction Failed: Signal Interference detected.");
    }
  };

  // --- ASSET CALCULATIONS ---

  const activeChains = lobbyInfo?.active_chains || [];
  const chainSizes = lobbyInfo?.chain_sizes || {};
  const netWorthValue = me ? (me.money + CORPORATIONS.reduce((acc, c) => acc + ((me.stocks[c] || 0) * getStockPrice(c, chainSizes[c] || 0)), 0)) : 0;
  
  const missionEndingAuthorized = activeChains.length > 0 && (
    activeChains.some(c => (chainSizes[c] || 0) >= 41) || 
    activeChains.every(c => (chainSizes[c] || 0) >= 11)
  );
  
  const vaultLowLevel = (lobbyInfo?.tile_pool?.length || 0) <= 10 && lobbyInfo?.status === 'playing';
  const activeOperativeManifest = players.filter(p => !p.is_spectator);
  const spectatorOperativeManifest = players.filter(p => p.is_spectator);
  const activeSwapRequest = players.find(p => !p.is_spectator && p.wants_to_swap);
  
  const rulesFilter = RULEBOOK.filter(directive => 
    directive.title.toLowerCase().includes(ruleSearchTerm.toLowerCase()) || 
    directive.text.toLowerCase().includes(ruleSearchTerm.toLowerCase()) ||
    directive.tags.some(t => t.toLowerCase().includes(ruleSearchTerm.toLowerCase()))
  );

  // Candidates for manual leadership reassignment
  const transferCandidates = activeOperativeManifest.filter(p => 
    p.id !== me?.id && 
    !(lobbyInfo?.host_transfer_data?.rejectedIds || []).includes(p.id)
  );
  
  // Dense Ranking Logic for Winner's Table
  const winnersRanking = useMemo(() => {
    const sorted = [...activeOperativeManifest].sort((a, b) => b.money - a.money);
    const uniqueScores = Array.from(new Set(sorted.map(p => p.money)));
    return sorted.map(p => ({
      ...p,
      rank: uniqueScores.indexOf(p.money) + 1
    }));
  }, [players]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans uppercase relative overflow-hidden">
      
      {/* HEADER: MISSION STATUS BAR */}
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center z-40 sticky top-0 shadow-lg">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-black text-amber-500 italic tracking-tighter uppercase">Syndicate Terminal</h1>
          {me?.is_spectator && (
            <span className="hidden md:inline-block text-[10px] font-mono bg-cyan-500/10 text-cyan-400 px-3 py-1.5 rounded-full border border-cyan-500/20 font-black tracking-widest animate-pulse uppercase">
              Observer Protocol Active
            </span>
          )}
          {lobbyInfo?.is_paused && (
            <span className="text-[10px] font-mono bg-rose-500/10 text-rose-500 px-3 py-1.5 rounded-full border border-rose-500/20 font-black tracking-widest animate-pulse uppercase">
              Tactical Breach Detected
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {/* TRANSFER HOST TRIGGER: Only visible to the current commander */}
          {isHost && (lobbyInfo?.status === 'playing' || lobbyInfo?.status === 'finished') && (
            <button 
              onClick={() => setIsTransferModalOpen(true)} 
              className="text-[9px] px-3 py-1 rounded-full border bg-amber-500 text-black border-amber-400 font-black tracking-widest uppercase hover:brightness-110 shadow-lg shadow-amber-900/20 transition-all"
            >
              TRANSFER HOST
            </button>
          )}

          {lobbyInfo && (
            <button onClick={() => setIsRulesModalOpen(true)} className="text-[9px] px-3 py-1 rounded-full border bg-slate-800 text-amber-400 border-amber-500/30 hover:bg-slate-700 transition-colors tracking-widest font-black uppercase">
              📜 Protocol Directives
            </button>
          )}
          <button onClick={toggleVoice} className={`text-[9px] px-3 py-1 rounded-full border transition-all ${isMicActive ? 'bg-emerald-500 text-black border-emerald-400 animate-pulse' : 'bg-slate-800 text-slate-500 border-slate-700'} uppercase`}>
            {isMicActive ? '🎙 Comms Link Active' : '🎤 Mic Muted'}
          </button>
          {lobbyInfo?.status === 'playing' && missionEndingAuthorized && me?.play_order === lobbyInfo.current_turn_index && (
            <button onClick={handleEndGame} className="bg-rose-600 px-4 py-1 rounded-full font-black text-[9px] border border-rose-400 hover:bg-rose-500 transition-colors uppercase">Terminate Mission</button>
          )}
          {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20 uppercase">{lobbyInfo.join_code}</span>}
        </div>
      </header>

      {/* FAILSAFE OVERLAY: LOCKDOWN UI */}
      {lobbyInfo?.is_paused && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[110] flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-slate-900 border-2 border-rose-600 p-10 rounded-3xl shadow-[0_0_60px_rgba(225,29,72,0.3)] animate-in zoom-in duration-300">
              <h2 className="text-3xl font-black text-white italic tracking-tighter mb-4 uppercase">Link Severed</h2>
              
              {/* Succession Subtitle */}
              {lobbyInfo.host_transfer_data?.isAutoMigration && (
                <p className="text-[10px] text-rose-500 font-black tracking-widest mb-4 animate-pulse uppercase">COMMANDER OFFLINE: RE-ASSIGNING LEADERSHIP</p>
              )}

              <div className="space-y-1 mb-8">
                {players.filter(p => !p.is_spectator && (new Date().getTime() - new Date(p.last_seen || 0).getTime() > 15000)).map(p => (
                  <p key={p.id} className="text-rose-500 font-mono text-xs tracking-widest font-black uppercase">{p.player_name} OFFLINE / TRACE LOST</p>
                ))}
              </div>
              
              {resumeCountdown !== null ? (
                <div className="space-y-4">
                   <p className="text-[10px] text-emerald-500 font-black tracking-widest uppercase">Stabilizing Link Frequency...</p>
                   <p className="text-6xl font-black text-white">{resumeCountdown}</p>
                </div>
              ) : (
                <>
                  <div className="bg-slate-950 p-6 rounded-2xl border border-rose-600/30 mb-8">
                     <p className="text-[10px] text-slate-500 font-black tracking-[0.3em] mb-2 uppercase">Extraction window</p>
                     <p className="text-4xl font-mono font-black text-rose-500 uppercase">
                       {Math.floor(reconnectSeconds / 60)}:{(reconnectSeconds % 60).toString().padStart(2, '0')}
                     </p>
                  </div>
                  <button 
                   onClick={handleRestartVote} 
                   disabled={reconnectSeconds > 0 || me?.wants_restart} 
                   className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-lg ${reconnectSeconds > 0 || me?.wants_restart ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-amber-500 text-black hover:bg-amber-400'} uppercase`}
                  >
                    {me?.wants_restart ? 'Awaiting Roster Consensus' : 'RESTART MISSION'}
                  </button>
                  <p className="mt-4 text-[8px] text-slate-600 font-black tracking-widest uppercase italic">Restart Authorization unlocks if link stability fails</p>
                </>
              )}
          </div>
        </div>
      )}

      {/* --- COMMAND HIERARCHY: MANUAL TRANSFER MODAL --- */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-[150] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-slate-900 border-2 border-amber-500/50 p-8 rounded-3xl shadow-2xl overflow-hidden">
            <h3 className="text-xl font-black text-white italic mb-6 text-center uppercase tracking-tighter">TRANSFER HOST AUTHORITY</h3>
            <p className="text-[9px] text-slate-500 text-center mb-6 uppercase tracking-widest">Select an active operative to receive full terminal command.</p>
            <div className="space-y-2 mb-8 max-h-[40vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
              {transferCandidates.length > 0 ? transferCandidates.map(p => (
                <button 
                  key={p.id} 
                  onClick={() => handleInitiateHostTransfer(p.id)}
                  className="w-full bg-slate-800 p-4 rounded-xl font-black text-xs hover:bg-amber-500 hover:text-black transition-all text-left flex justify-between items-center group uppercase"
                >
                  <span>{p.player_name}</span>
                  <span className="text-[9px] opacity-50 group-hover:opacity-100 font-bold uppercase">INITIATE HANDSHAKE</span>
                </button>
              )) : (
                <p className="text-center text-slate-500 text-[10px] py-10 uppercase italic">No valid active players in range.</p>
              )}
            </div>
            <button 
              onClick={() => setIsTransferModalOpen(false)} 
              className="w-full py-4 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 font-black uppercase text-[10px] tracking-widest hover:text-white transition-colors"
            >
              CANCEL PROTOCOL
            </button>
          </div>
        </div>
      )}

      {/* --- WINNER'S TABLE MODAL --- */}
      {isWinnersTableOpen && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[200] flex items-center justify-center p-6 animate-in fade-in zoom-in duration-500">
          <div className="max-w-md w-full bg-slate-900 border-2 border-amber-500 p-8 rounded-[3rem] shadow-[0_0_100px_rgba(245,158,11,0.2)] text-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
             <h2 className="text-4xl font-black text-white italic tracking-tighter mb-2 uppercase">MISSION ACCOMPLISHED</h2>
             <p className="text-[10px] text-amber-500 font-black tracking-[0.4em] mb-8 uppercase">Final Executive Standings</p>
             
             <div className="space-y-3 mb-10">
               {winnersRanking.map((p) => {
                 let medal = "";
                 let textColor = "text-slate-400";
                 let bgColor = "bg-slate-800/30";
                 let borderColor = "border-slate-800";
                 
                 if (p.rank === 1) { medal = "🥇"; textColor = "text-white"; bgColor = "bg-amber-500/20"; borderColor = "border-amber-500"; }
                 else if (p.rank === 2) { medal = "🥈"; textColor = "text-slate-200"; bgColor = "bg-slate-400/10"; borderColor = "border-slate-400"; }
                 else if (p.rank === 3) { medal = "🥉"; textColor = "text-orange-200"; bgColor = "bg-orange-900/10"; borderColor = "border-orange-900/50"; }

                 return (
                   <div key={p.id} className={`flex justify-between items-center p-4 rounded-2xl border transition-all ${bgColor} ${borderColor} ${p.rank <= 3 ? 'scale-105 shadow-lg' : 'opacity-60 scale-95'}`}>
                      <div className="flex items-center gap-3">
                         <span className="text-2xl">{medal}</span>
                         <span className={`font-black text-sm tracking-tight ${textColor}`}>{p.player_name}</span>
                      </div>
                      <span className="font-mono font-black text-emerald-400">${p.money.toLocaleString()}</span>
                   </div>
                 );
               })}
             </div>

             <button 
               onClick={() => setIsWinnersTableOpen(false)}
               className="w-full bg-amber-500 text-black font-black py-4 rounded-2xl uppercase tracking-widest hover:bg-amber-400 transition-all shadow-lg active:scale-95"
             >
               Close Protocol
             </button>
          </div>
        </div>
      )}

      {/* --- COMMAND HIERARCHY: HANDSHAKE CONFIRMATION --- */}
      {lobbyInfo?.host_transfer_data?.status === 'pending' && lobbyInfo.host_transfer_data.targetId === me?.id && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[160] flex items-center justify-center p-6 animate-in zoom-in duration-300">
           <div className="max-w-sm w-full bg-amber-500 p-1 rounded-3xl shadow-[0_0_100px_rgba(245,158,11,0.3)]">
              <div className="bg-slate-900 rounded-[1.4rem] p-8 text-center border border-amber-500/30">
                 <div className="w-16 h-16 bg-amber-500/10 border-2 border-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="text-2xl">⚡</span>
                 </div>
                 <p className="text-[9px] text-amber-500 font-black tracking-[0.3em] mb-4 uppercase">Direct Command Request</p>
                 <h2 className="text-2xl font-black text-white italic mb-8 uppercase tracking-tighter leading-tight">THE CURRENT HOST IS TRANSFERRING AUTHORITY TO YOU. ACCEPT?</h2>
                 <div className="flex gap-4">
                    <button 
                      onClick={() => handleResponseHostTransfer(true)} 
                      className="flex-1 bg-emerald-600 py-4 rounded-xl font-black text-white shadow-lg active:scale-95 transition-all uppercase"
                    >
                      YES, COMMAND
                    </button>
                    <button 
                      onClick={() => handleResponseHostTransfer(false)} 
                      className="flex-1 bg-rose-600 py-4 rounded-xl font-black text-white shadow-lg active:scale-95 transition-all uppercase"
                    >
                      DECLINE
                    </button>
                 </div>
                 <p className="mt-6 text-[8px] text-slate-500 font-bold uppercase italic tracking-widest">Leadership requires active terminal monitoring</p>
              </div>
           </div>
        </div>
      )}

      {/* --- LEAVE LOUNGE CONFIRMATION MODAL --- */}
      {isLeaveLoungeModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-[150] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="max-w-sm w-full bg-slate-900 border-2 border-amber-500/50 p-8 rounded-3xl shadow-[0_0_50px_rgba(245,158,11,0.2)] text-center">
            <h3 className="text-2xl font-black text-white italic tracking-tighter mb-2 uppercase">Terminate Session?</h3>
            <p className="text-[10px] text-slate-500 font-bold tracking-widest mb-8 uppercase">You are about to disconnect from this terminal frequency. You can rejoin using the hex code.</p>
            <div className="flex gap-4">
              <button 
                onClick={handleExecuteLoungeExit} 
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-rose-900/20 uppercase"
              >
                YES
              </button>
              <button 
                onClick={() => setIsLeaveLoungeModalOpen(false)} 
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-black py-4 rounded-xl transition-all uppercase"
              >
                NO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RULES MODAL: PROTOCOL ARCHIVE */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-sm z-50 flex flex-col p-4 md:p-8 overflow-hidden animate-in fade-in duration-300">
          <div className="max-w-3xl w-full mx-auto flex flex-col h-full bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950">
              <h2 className="text-2xl font-black text-amber-500 italic tracking-tighter uppercase">Official Rulebook Archive</h2>
              <button onClick={() => setIsRulesModalOpen(false)} className="text-slate-500 hover:text-white text-2xl font-black transition-colors uppercase">&times;</button>
            </div>
            
            <div className="p-6 bg-slate-900 border-b border-slate-800">
              <input 
                type="text" 
                value={ruleSearchTerm} 
                onChange={(e) => setRuleSearchTerm(e.target.value)} 
                placeholder="SEARCH DIRECTIVES (e.g., 'merger', 'tie', 'safe')..." 
                className="w-full bg-slate-950 p-4 rounded-xl border border-slate-700 text-amber-500 placeholder-slate-600 focus:border-amber-500 outline-none font-mono tracking-widest text-sm transition-all uppercase"
                autoFocus
              />
            </div>

            <div className="p-6 overflow-y-auto flex-grow space-y-4">
              {rulesFilter.length === 0 ? (
                <p className="text-slate-500 text-center text-sm tracking-widest font-black mt-10 uppercase">No matching directives found in archive.</p>
              ) : (
                rulesFilter.map(directive => (
                  <div key={directive.id} className="bg-slate-800/50 border border-slate-700 p-5 rounded-2xl hover:border-amber-500/50 transition-colors">
                    <h3 className="text-lg font-black text-slate-200 mb-2 tracking-tight uppercase">{directive.title}</h3>
                    <p className="text-xs text-slate-400 normal-case leading-relaxed font-mono uppercase">{directive.text}</p>
                    <div className="mt-4 flex gap-2 flex-wrap">
                      {directive.tags.map(tag => (
                        <span key={tag} className="text-[8px] bg-slate-950 text-slate-500 px-2 py-1 rounded border border-slate-800 tracking-widest font-black uppercase">#{tag}</span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN THEATER CONTENT */}
      <div className="flex-grow overflow-hidden relative">
        
        {/* TURN NOTIFICATION */}
        {isMyTurnAlert && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
            <div className="bg-amber-500/10 border-2 border-amber-500 text-amber-500 px-8 py-6 md:px-12 md:py-8 rounded-3xl shadow-[0_0_80px_rgba(245,158,11,0.4)] backdrop-blur-md animate-in zoom-in-75 fade-in duration-300">
              <h2 className="text-4xl md:text-6xl font-black italic tracking-tighter uppercase text-center drop-shadow-[0_0_15px_rgba(245,158,11,0.8)]">
                Authorization<br/>Granted
              </h2>
              <p className="text-center mt-4 font-mono text-[10px] md:text-xs tracking-[0.5em] text-amber-200 font-bold uppercase">Awaiting your directive</p>
            </div>
          </div>
        )}

        {lobbyInfo?.status === 'terminated' ? (
          <div className="flex items-center justify-center p-6 h-full bg-rose-950/20">
            <div className="bg-slate-900 border-2 border-rose-600 p-10 rounded-3xl text-center shadow-2xl max-lg w-full">
              <p className="text-[10px] text-rose-500 font-black tracking-widest mb-4 uppercase">Critical Override Executed</p>
              <h2 className="text-4xl font-black text-white italic mb-8 uppercase tracking-tighter">Lobby Disbanded</h2>
              <button onClick={() => window.location.reload()} className="w-full bg-rose-600 text-white font-black py-4 rounded-xl uppercase hover:bg-rose-500 shadow-lg tracking-widest uppercase">Return to base</button>
            </div>
          </div>
        ) : lobbyInfo?.status === 'finished' ? (
          <div className="flex flex-col items-center justify-center p-6 h-full animate-in fade-in zoom-in duration-500 relative">
            
            {/* TERMINATION OVERLAYS */}
            {lobbyInfo.end_session_data?.phase === 'voting' && (
               <div className="absolute top-10 left-1/2 -translate-x-1/2 z-[60] bg-rose-900/90 border border-rose-500 p-6 rounded-2xl shadow-2xl w-full max-w-md text-center backdrop-blur-md">
                 {!me?.is_host && !me?.is_spectator ? (
                   <>
                     <h3 className="text-lg font-black text-white mb-4 uppercase tracking-tighter">Host Proposed Lobby Shutdown. Comply?</h3>
                     <div className="flex gap-4">
                       <button onClick={() => handleVoteEndLobby('yes')} className="flex-1 bg-emerald-600 py-3 rounded-xl font-black text-white shadow-lg uppercase">Yes</button>
                       <button onClick={() => handleVoteEndLobby('no')} className="flex-1 bg-rose-600 py-3 rounded-xl font-black text-white shadow-lg uppercase">No</button>
                     </div>
                   </>
                 ) : (
                   <h3 className="text-sm font-black text-rose-200 tracking-widest animate-pulse uppercase">Waiting for Operative Consensus...</h3>
                 )}
               </div>
            )}

            {lobbyInfo.end_session_data?.phase === 'countdown' && (
               <div className="absolute top-10 left-1/2 -translate-x-1/2 z-[60] bg-black border-2 border-rose-600 p-8 rounded-3xl shadow-[0_0_50px_rgba(225,29,72,0.5)] w-full max-w-md text-center backdrop-blur-md">
                 {me?.is_host ? (
                   <>
                     <h3 className="text-xl font-black text-rose-500 mb-2 uppercase">Final Session Purge</h3>
                     <p className="text-6xl font-mono text-white font-black mb-6 uppercase">{shutdownCountdown}</p>
                     <div className="flex gap-4">
                       <button onClick={handleConfirmEndLobby} className="flex-1 bg-rose-600 py-4 rounded-xl font-black text-white shadow-lg active:scale-95 transition-all uppercase">End</button>
                       <button onClick={handleRetractEndLobby} className="flex-1 bg-slate-700 py-4 rounded-xl font-black text-white shadow-lg hover:bg-slate-600 active:scale-95 transition-all uppercase">Retract</button>
                     </div>
                   </>
                 ) : (
                   <h3 className="text-lg font-black text-rose-500 tracking-widest animate-pulse uppercase">Host is initiating shutdown...</h3>
                 )}
               </div>
            )}

            {/* RELIEF REQUEST POP-UP */}
            {me?.is_spectator && activeSwapRequest && !lobbyInfo.end_session_data?.phase && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-cyan-900 border-2 border-cyan-400 p-6 rounded-3xl shadow-[0_0_40px_rgba(34,211,238,0.3)] w-full max-w-sm text-center animate-in slide-in-from-top duration-500">
                <p className="text-[10px] text-cyan-200 font-black tracking-[0.3em] mb-2 animate-pulse uppercase">Roster adjustment required</p>
                <h3 className="text-xl font-black text-white italic tracking-tighter mb-6 uppercase">Agent {activeSwapRequest.player_name} Requests Relief.</h3>
                <button onClick={() => handleAcceptSwap(activeSwapRequest.id)} className="w-full bg-cyan-500 text-black font-black py-4 rounded-xl uppercase hover:bg-cyan-400 transition-all shadow-lg tracking-widest active:scale-95 uppercase">
                  Join active roster
                </button>
              </div>
            )}

            <h2 className="text-5xl font-black text-amber-500 mb-8 italic tracking-tighter uppercase">Asset Liquidation Standings</h2>
            
            <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 w-full max-w-md space-y-4 shadow-2xl relative mb-10">
              {[...activeOperativeManifest].sort((a, b) => b.money - a.money).map((p, i) => (
                <div key={p.id} className={`flex justify-between items-center p-5 rounded-2xl border transition-all ${i === 0 ? 'border-amber-500 bg-amber-500/10 scale-105' : 'border-slate-800 bg-slate-800/50'} uppercase`}>
                  <span className="font-black text-lg">#{i + 1} {p.player_name} {p.is_host && <b className="text-amber-500 ml-1 text-xs">(HOST)</b>}</span>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-emerald-400 font-bold uppercase">${p.money.toLocaleString()}</span>
                    
                    {/* SWAP BUTTON */}
                    {me?.id === p.id && !me?.is_spectator && !lobbyInfo.end_session_data?.phase && (
                      <button 
                        onClick={handleRequestSwap} 
                        disabled={me?.wants_to_swap}
                        className={`text-[9px] px-3 py-1.5 rounded-lg font-black tracking-widest transition-all ${me?.wants_to_swap ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30 cursor-not-allowed' : 'bg-slate-800 text-slate-300 border border-slate-600 hover:bg-slate-700 active:scale-90'} uppercase`}
                      >
                        {me?.wants_to_swap ? 'Waiting for Relief' : 'Swap'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4">
              <button onClick={() => window.location.reload()} className="bg-amber-500 text-black px-8 py-3 rounded-xl font-black uppercase hover:bg-amber-400 transition-colors uppercase">Return to Base</button>
              {me?.is_host && !lobbyInfo.end_session_data?.phase && (
                <button onClick={handleInitiateEndLobby} className="bg-rose-950 text-rose-500 border border-rose-500 px-8 py-3 rounded-xl font-black uppercase hover:bg-rose-900 transition-colors tracking-widest uppercase">End Session</button>
              )}
            </div>
          </div>
        ) : !lobbyInfo ? (
          /* AUTHENTICATION VIEW */
          <div className="max-w-md mx-auto pt-20 px-6 space-y-4">
            <div className="text-center mb-10">
              <p className="text-[10px] text-amber-500 font-black tracking-[0.3em] mb-2 uppercase">Authenticated Link Required</p>
              <h2 className="text-4xl font-black italic tracking-tighter text-slate-100 uppercase">Establish Channel</h2>
            </div>
            <input type="text" value={playerName} onChange={e => setPlayerName(e.target.value)} className="w-full bg-slate-900 p-4 rounded-xl border border-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 uppercase transition-all uppercase" placeholder="Agent Pseudonym" />
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setView('create')} className={`font-black p-4 rounded-xl uppercase transition-all ${view === 'create' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-400'} uppercase`}>Create</button>
              <button onClick={() => setView('join')} className={`font-black p-4 rounded-xl uppercase transition-all ${view === 'join' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-400'} uppercase`}>Join</button>
            </div>
            {view === 'join' && <input type="text" value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="w-full bg-slate-900 p-4 rounded-xl border border-slate-800 text-center font-mono uppercase focus:border-amber-500 outline-none transition-all uppercase" placeholder="HEX CODE" />}
            {(view === 'join' || view === 'create') && playerName && (
              <button onClick={view === 'create' ? (e) => handleCreateLobby(e as any) : (e) => handleJoinLobby(e as any)} className="w-full bg-emerald-500 text-white font-black p-4 rounded-xl uppercase tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 uppercase">
                {isReentering ? 'Re-authorize Connection' : 'Establish Transmission'}
              </button>
            )}
          </div>
        ) : lobbyInfo.status === 'waiting' ? (
          /* WAITING ROOM VIEW */
          <div className="text-center pt-10 pb-20 px-4 animate-in fade-in duration-700 h-full overflow-y-auto">
            <p className="text-[10px] text-slate-500 font-black tracking-widest mb-4 uppercase">Frequency Established</p>
            <h2 className="text-5xl lg:text-7xl font-mono text-amber-400 mb-10 tracking-tighter border-y border-slate-800 py-6 inline-block px-8 lg:px-12 uppercase">{lobbyInfo.join_code}</h2>
            
            <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 w-full max-w-sm mx-auto shadow-xl text-left">
              <p className="text-[8px] text-emerald-500 font-black mb-4 tracking-widest uppercase">Active Operatives ({activeOperativeManifest.length}/6)</p>
              <div className="space-y-2">
                {activeOperativeManifest.map(p => (
                  <div key={p.id} className={`text-sm font-bold flex justify-between uppercase p-3 rounded-xl border transition-all ${p.is_host ? 'bg-amber-500/10 border-amber-500 shadow-lg' : 'bg-slate-800/50 border-slate-800'} uppercase`}>
                    <span>{p.player_name} {p.is_host && <b className="text-amber-500 ml-1 text-xs">(HOST)</b>}</span>
                    {p.is_host && <span className="text-amber-500 text-[10px] font-black tracking-widest uppercase">Host</span>}
                  </div>
                ))}
              </div>

              {spectatorOperativeManifest.length > 0 && (
                <>
                  <p className="text-[8px] text-cyan-500 font-black mt-8 mb-4 tracking-widest uppercase border-t border-slate-800 pt-6 uppercase">Observer Lounge</p>
                  <div className="space-y-2">
                    {spectatorOperativeManifest.map(p => (
                      <div key={p.id} className="text-xs font-bold flex justify-between items-center uppercase bg-slate-950/50 p-2 rounded-lg border border-slate-800/50 text-slate-400 uppercase">
                        <span>{p.player_name}</span>
                        <div className="flex items-center gap-2">
                           <span className="text-[9px] font-black tracking-widest uppercase">Observer</span>
                           {me?.id === p.id && (
                             <button 
                               onClick={() => setIsLeaveLoungeModalOpen(true)}
                               className="text-[8px] bg-rose-600/20 text-rose-500 border border-rose-500/30 px-2 py-1 rounded font-black hover:bg-rose-600 hover:text-white transition-all uppercase"
                             >
                               Leave Lounge
                             </button>
                           )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {isHost && activeOperativeManifest.length >= 3 && (
              <button onClick={handleStartGame} className="mt-10 bg-emerald-500 px-12 py-4 rounded-2xl font-black text-white shadow-xl shadow-emerald-500/20 uppercase tracking-widest hover:scale-105 transition-all uppercase">
                Initiate Grid Operations
              </button>
            )}
          </div>
        ) : (
          /* ACTIVE GRID THEATER */
          <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6 overflow-hidden">
            
            {/* GRID DISPLAY */}
            <div className={`lg:col-span-8 p-4 lg:p-6 bg-slate-900 lg:rounded-3xl border border-slate-800 overflow-auto flex flex-col relative shadow-inner ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'} uppercase`}>
              
              {/* PHASE OVERLAY: FOUNDING */}
              {lobbyInfo.turn_phase === 'found_chain' && me?.play_order === lobbyInfo.current_turn_index && !me?.is_spectator && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-40 flex items-center justify-center p-4">
                  <div className="bg-slate-900 p-8 rounded-3xl border border-amber-500 shadow-2xl text-center max-w-sm w-full">
                    <h3 className="font-black text-amber-500 mb-2 uppercase tracking-widest">Establish Infrastructure</h3>
                    <p className="text-[9px] text-slate-500 mb-6 font-bold uppercase tracking-widest">Select an available syndicate to represent this expansion</p>
                    <div className="grid grid-cols-2 gap-3">
                      {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(c => (
                        <button key={c} onClick={() => handleFoundChain(c)} className={`${CORP_METADATA[c].bg} p-4 rounded-xl font-black text-[10px] uppercase shadow-lg hover:brightness-125 transition-all uppercase`}>{c}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* PHASE OVERLAY: MERGER */}
              {lobbyInfo.turn_phase === 'merger_resolution' && players[lobbyInfo.disposition_turn_index]?.player_name === playerName && !me?.is_spectator && (me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0) > 0 && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-40 flex items-center justify-center p-4">
                  <div className="bg-slate-900 p-8 rounded-3xl border border-emerald-500 shadow-2xl text-center max-w-sm w-full">
                    <h3 className="font-black text-emerald-400 mb-1 uppercase tracking-widest">Hostile Acquisition</h3>
                    <p className="text-[9px] text-slate-400 font-bold mb-4 uppercase tracking-widest uppercase">{lobbyInfo.merger_data.current_defunct} is being liquidated</p>
                    
                    <div className="bg-slate-800 p-4 rounded-xl mb-6 border border-slate-700">
                       <p className="text-xs font-bold text-slate-300 mb-4 uppercase">Your Shares: <span className="text-amber-500 text-lg uppercase">{me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0}</span></p>
                       
                       <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400 uppercase">Sell ($)</span>
                          <div className="flex gap-2 items-center">
                              <button onClick={() => setSellCount(Math.max(0, sellCount - 1))} className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 transition-colors uppercase">-</button>
                              <span className="w-6 font-mono font-bold text-center uppercase">{sellCount}</span>
                              <button onClick={() => setSellCount(sellCount + 1)} disabled={sellCount + (tradePairs * 2) >= (me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0)} className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors uppercase">+</button>
                          </div>
                       </div>

                       <div className="flex justify-between items-center mb-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 uppercase">Trade (2:1 for {lobbyInfo.merger_data.survivor})</span>
                          <div className="flex gap-2 items-center">
                              <button onClick={() => setTradePairs(Math.max(0, tradePairs - 1))} className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 transition-colors uppercase">-</button>
                              <span className="w-6 font-mono font-bold text-center uppercase">{tradePairs}</span>
                              <button 
                                onClick={() => setTradePairs(tradePairs + 1)} 
                                disabled={
                                  sellCount + ((tradePairs + 1) * 2) > (me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0) || 
                                  (tradePairs + 1) > (lobbyInfo.available_stocks[lobbyInfo.merger_data.survivor!] || 0)
                                } 
                                className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors uppercase"
                              >
                                +
                              </button>
                          </div>
                       </div>

                       <div className="flex justify-between items-center mt-4 border-t border-slate-700 pt-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 uppercase">Keep Manifest</span>
                          <span className="font-mono text-emerald-400 font-black text-lg uppercase">{(me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0) - sellCount - (tradePairs * 2)}</span>
                       </div>
                    </div>

                    <button onClick={() => handleDisposition(sellCount, tradePairs)} className="w-full bg-emerald-600 text-white font-black py-4 rounded-xl uppercase hover:bg-emerald-500 transition-all shadow-lg tracking-widest uppercase">Execute Acquisition Strategy</button>
                  </div>
                </div>
              )}

              {/* GRID COORDINATES */}
              <div className="grid grid-cols-12 gap-1 mb-8 p-1 bg-slate-950/50 rounded-xl border border-slate-800/50">
                {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
                  const id = `${c}${r}`;
                  const owner = lobbyInfo.tile_ownership[id];
                  const isPlaced = lobbyInfo.board_state.includes(id);
                  const isSafe = owner && (lobbyInfo.chain_sizes[owner] || 0) >= 11;
                  return (
                    <div key={id} className={`aspect-square flex flex-col items-center justify-center rounded-md text-[8px] lg:text-[10px] font-bold border transition-all duration-300 ${isPlaced ? (owner ? `${CORP_METADATA[owner].bg} border-white/30 shadow-[0_0_15px_rgba(255,255,255,0.1)]` : 'bg-amber-500 text-black border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)] scale-95') : 'bg-slate-800/20 text-slate-700 border-slate-800/40'} uppercase`}>
                      {id} {isSafe && <span className="text-[7px] mt-0.5 animate-pulse uppercase">🛡️</span>}
                    </div>
                  );
                }))}
              </div>

              {/* OPERATIVE TACTICAL HAND */}
              {me?.is_spectator ? (
                <div className="flex flex-col justify-center items-center h-40 bg-slate-950/30 rounded-xl border border-cyan-500/10 mt-auto mb-4 gap-4 uppercase">
                  <span className="text-cyan-500/50 font-black text-sm tracking-[0.4em] uppercase">Observer protocol active. Interception restricted.</span>
                  <button 
                    onClick={() => setIsLeaveLoungeModalOpen(true)}
                    className="bg-rose-950/20 text-rose-500 border border-rose-500/30 px-6 py-2 rounded-full text-[10px] font-black tracking-widest hover:bg-rose-600 hover:text-white transition-all uppercase"
                  >
                    Disconnect from Lounge
                  </button>
                </div>
              ) : (
                <div className="flex justify-center gap-2 mt-auto pb-4 uppercase">
                  {me?.hand?.map((t: string) => {
                    const legality = getTileLegality(t);
                    const isMyTurn = lobbyInfo.current_turn_index === me?.play_order;
                    const isPlacePhase = lobbyInfo.turn_phase === 'place_tile';
                    
                    return (
                      <div key={t} className="relative group uppercase">
                        <button 
                          onClick={() => handlePlaceTile(t)} 
                          disabled={!isMyTurn || !isPlacePhase || legality !== 'valid' || lobbyInfo.is_paused} 
                          className={`w-12 h-12 lg:w-16 lg:h-16 font-black rounded-xl shadow-2xl transition-all uppercase relative overflow-hidden flex items-center justify-center
                            ${legality === 'valid' ? 'bg-amber-500 text-black hover:scale-110 active:scale-95 disabled:opacity-20' : ''}
                            ${legality === 'temporarily_unplayable' ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed' : ''}
                            ${legality === 'permanently_unplayable' ? 'bg-rose-950/50 text-rose-500 border border-rose-500/30' : ''}
                          `}
                        >
                          <span className="z-10 uppercase">{t}</span>
                          {legality === 'permanently_unplayable' && isMyTurn && isPlacePhase && (
                            <div onClick={(e) => { e.stopPropagation(); handleSwapTile(t); }} className="absolute inset-0 bg-rose-600 text-white flex items-center justify-center text-[7px] font-black opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer uppercase">Swap</div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-50 uppercase" />
                        </button>
                        {legality !== 'valid' && (
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black/90 text-[7px] px-3 py-1.5 rounded-lg border border-slate-800 opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none transition-all shadow-xl uppercase">
                            {legality === 'permanently_unplayable' ? 'Illegal merger: SAFE SYNDICATE BLOCK' : 'Founding capacity reached (MAX 7)'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SIDE PANEL: MARKET & INTELLIGENCE */}
            <div className={`lg:col-span-4 flex flex-col gap-4 overflow-y-auto pb-24 lg:pb-0 ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'} uppercase`}>
              
              {/* OPERATIVE DRAW RESULTS */}
              <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-lg uppercase">
                <h3 className="text-[9px] font-black text-slate-500 mb-3 uppercase tracking-widest uppercase">Draw Ceremony Log</h3>
                <div className="space-y-1 uppercase">
                  {activeOperativeManifest.map(p => (
                    <div key={p.id} className={`flex justify-between items-center px-4 py-2.5 rounded-xl border transition-all ${p.play_order === lobbyInfo.current_turn_index ? 'border-amber-500 bg-amber-500/5 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'border-transparent bg-slate-800/50'} uppercase`}>
                      <span className="text-xs font-bold uppercase tracking-tight uppercase">{p.player_name} {p.is_host && <b className="text-amber-500 ml-1 text-[10px]">(H)</b>}</span>
                      <span className="text-[9px] font-black bg-slate-950 px-3 py-1.5 rounded-lg text-amber-500 font-mono tracking-tighter shadow-inner border border-slate-800 uppercase">{p.starting_tile}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SPECTATOR LOG */}
              {spectatorOperativeManifest.length > 0 && (
                <div className="bg-slate-900 p-4 rounded-2xl border border-cyan-500/20 shadow-lg uppercase">
                  <h3 className="text-[9px] font-black text-cyan-500 mb-3 uppercase tracking-widest uppercase">Spectator Lounge</h3>
                  <div className="flex flex-wrap gap-2 uppercase">
                    {spectatorOperativeManifest.map(p => (
                      <div key={p.id} className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 uppercase">
                        <span className="text-[9px] text-slate-400 font-bold uppercase">{p.player_name}</span>
                        {me?.id === p.id && (
                           <button 
                             onClick={() => setIsLeaveLoungeModalOpen(true)}
                             className="text-[8px] text-rose-500 font-black hover:underline transition-all uppercase"
                           >
                             EXIT
                           </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ASSET PORTFOLIO */}
              {!me?.is_spectator && (
                <div className="bg-slate-900 p-6 rounded-3xl border border-amber-500/20 shadow-2xl relative overflow-hidden group uppercase">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity uppercase">
                     <span className="text-4xl font-black italic uppercase">Vault</span>
                  </div>
                  <h3 className="text-[10px] font-black text-slate-500 mb-4 uppercase border-b border-slate-800 pb-2 tracking-widest uppercase">Portfolio Matrix</h3>
                  <div className="flex justify-between items-end mb-6 uppercase">
                    <div>
                      <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1 uppercase">Available Liquidity</p>
                      <p className="text-3xl font-black text-emerald-400 font-mono tracking-tighter uppercase">${me?.money.toLocaleString()}</p>
                    </div>
                    <div className="text-right uppercase">
                      <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1 uppercase">Total Net Worth</p>
                      <p className="text-sm font-bold font-mono text-slate-100 uppercase">${netWorthValue.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 uppercase">
                    {CORPORATIONS.map(corp => (
                      <div key={corp} className={`flex justify-between items-center text-[10px] font-bold p-3 rounded-xl border transition-all ${me?.stocks[corp] ? 'bg-slate-800 border-slate-700 opacity-100' : 'bg-slate-900/50 border-transparent opacity-20 grayscale'} uppercase`}>
                        <span className="uppercase tracking-tighter uppercase">{corp}</span>
                        <span className="font-mono text-amber-500 bg-black/40 px-2 py-0.5 rounded-md shadow-inner uppercase">{me?.stocks[corp] || 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MARKET EXCHANGE */}
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-2xl flex-grow flex flex-col uppercase">
                <h3 className="text-[10px] font-black text-slate-500 mb-4 uppercase tracking-widest uppercase">Market Exchange</h3>
                <div className="space-y-2 flex-grow overflow-auto pr-2 uppercase">
                  {CORPORATIONS.map(syndicate => {
                    const chainSizeValue = lobbyInfo.chain_sizes[syndicate] || 0;
                    const syndicateActive = lobbyInfo.active_chains.includes(syndicate);
                    const currentSharePrice = getStockPrice(syndicate, chainSizeValue);
                    const canPurchase = syndicateActive && (lobbyInfo.current_turn_index === me?.play_order) && !me?.is_spectator && (stocksBoughtThisTurn < 3) && ((me?.money || 0) >= currentSharePrice) && ((lobbyInfo.available_stocks[syndicate] || 0) > 0);
                    
                    return (
                      <div key={syndicate} className={`w-full flex justify-between items-center p-3 rounded-xl font-black text-[11px] border transition-all ${syndicateActive ? 'bg-slate-800 border-slate-700 shadow-md' : 'opacity-10 border-transparent grayscale'} uppercase`}>
                        <div className="flex items-center gap-3 uppercase">
                          <div className={`w-1 h-6 rounded-full ${CORP_METADATA[syndicate].bg} uppercase`} />
                          <div className="flex flex-col uppercase">
                            <span className="tracking-tight uppercase">{syndicate}</span>
                            <span className="text-[8px] text-slate-500 uppercase uppercase">Size: {chainSizeValue} | Avail: {lobbyInfo.available_stocks[syndicate]}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 uppercase">
                          <span className="text-emerald-400 font-mono text-sm uppercase">${currentSharePrice}</span>
                          {!me?.is_spectator && (
                            <button onClick={() => handleBuyStock(syndicate)} disabled={!canPurchase || lobbyInfo.is_paused} className={`px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow-md transition-all ${canPurchase ? 'bg-amber-500 text-black hover:bg-amber-400 active:scale-90' : 'bg-slate-950 text-slate-700 cursor-not-allowed opacity-0'} uppercase`}>Buy</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks' && !me?.is_spectator && (
                  <button onClick={handleEndTurn} disabled={lobbyInfo.is_paused} className="w-full bg-emerald-600 py-5 rounded-2xl font-black text-[11px] mt-6 uppercase tracking-[0.2em] shadow-lg shadow-emerald-500/10 flex justify-center items-center gap-3 hover:bg-emerald-500 transition-all active:scale-95 group disabled:opacity-50 uppercase">
                    <span>Transmit Directive</span>
                    <span className="bg-black/20 px-3 py-1 rounded-lg text-[9px] font-mono group-hover:bg-black/30 uppercase">({stocksBoughtThisTurn}/3)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MOBILE INTERFACE TABS */}
      {lobbyInfo?.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-2 items-center z-50 fixed bottom-0 left-0 right-0 shadow-2xl uppercase">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'board' ? 'text-amber-500' : 'text-slate-600'} uppercase`}>
            <span className="text-2xl font-black uppercase">◫</span>
            <span className="text-[8px] font-black tracking-widest uppercase">Tactical Grid</span>
          </button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'market' ? 'text-amber-500' : 'text-slate-600'} uppercase`}>
            <span className="text-2xl font-black uppercase">＄</span>
            <span className="text-[8px] font-black tracking-widest uppercase">Market Exchange</span>
          </button>
        </nav>
      )}
    </main>
  );
}