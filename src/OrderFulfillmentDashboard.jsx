/* global __app_id, __firebase_config, __initial_auth_token */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, doc, collection, query, onSnapshot, updateDoc, deleteDoc, setLogLevel, addDoc, getDocs 
} from 'firebase/firestore';

// --- Constantes y Configuración ---
// Variables de entorno proporcionadas por el entorno de Canvas
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Estados posibles de los pedidos
const STATUS_OPTIONS = [
  { value: 'new', label: 'Nuevo', color: 'bg-blue-500', icon: '📦' },
  { value: 'preparing', label: 'En Preparación', color: 'bg-yellow-500', icon: '🛠️' },
  { value: 'ready_to_ship', label: 'Listo para Despacho', color: 'bg-purple-500', icon: '🚚' },
  { value: 'shipped', label: 'Enviado', color: 'bg-green-500', icon: '✅' },
  { value: 'cancelled', label: 'Cancelado', color: 'bg-red-500', icon: '❌' },
];

// Helper para obtener color y ícono de estado
const getStatusDetails = (statusValue) => STATUS_OPTIONS.find(s => s.value === statusValue) || STATUS_OPTIONS[0];

// --- Componente Principal ---
const App = () => {
  // Estado de la aplicación
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [orders, setOrders] = useState([]);
  const [linkedMarketplaces, setLinkedMarketplaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // Filtro de estado
  const [searchTerm, setSearchTerm] = useState(''); // Búsqueda

  // --- 1. Inicialización de Firebase y Autenticación ---

  useEffect(() => {
    if (!firebaseConfig) {
      setError("Error: La configuración de Firebase está ausente.");
      setLoading(false);
      return;
    }

    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authInstance = getAuth(app);
      
      setDb(firestore);
      setAuth(authInstance);
      setLogLevel('debug'); // Habilitar logs

      const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else if (initialAuthToken) {
          // Si no hay usuario pero hay token, intentar iniciar sesión
          await signInWithCustomToken(authInstance, initialAuthToken);
        } else {
          // Si no hay token, iniciar sesión anónimamente (para desarrollo)
          await signInAnonymously(authInstance);
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Error al inicializar Firebase:", e);
      setError(`Error al inicializar Firebase: ${e.message}`);
      setLoading(false);
    }
  }, []);

  // --- 2. Referencias a Colecciones ---

  const getOrderCollectionRef = useCallback(() => {
    if (!db || !userId) return null;
    // Data pública compartida por todos los usuarios de la app
    return collection(db, `artifacts/${appId}/public/data/orders`);
  }, [db, userId]);

  const getMarketplaceCollectionRef = useCallback(() => {
    if (!db || !userId) return null;
    // Data privada del usuario (integraciones de marketplace)
    return collection(db, `artifacts/${appId}/users/${userId}/marketplace_integrations`);
  }, [db, userId]);

  // --- 3. Carga de Datos (Orders y Marketplaces) ---

  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;

    // Listener para Marketplaces vinculados (necesario para el select de "Agregar Pedido")
    const marketplaceRef = getMarketplaceCollectionRef();
    if (marketplaceRef) {
      const unsubscribeMarketplaces = onSnapshot(marketplaceRef, (snapshot) => {
        setLinkedMarketplaces(snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })));
      }, (e) => console.error("Error al escuchar marketplaces:", e));
      
      // Listener para Pedidos
      const orderRef = getOrderCollectionRef();
      if (orderRef) {
        const unsubscribeOrders = onSnapshot(orderRef, (snapshot) => {
          const fetchedOrders = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Asegurar que la fecha sea un objeto Date para ordenar
            order_date: doc.data().order_date ? new Date(doc.data().order_date.seconds * 1000) : new Date(),
          }));
          setOrders(fetchedOrders);
          setLoading(false);
        }, (e) => {
          console.error("Error al escuchar pedidos:", e);
          setError(`Error al cargar pedidos: ${e.message}`);
          setLoading(false);
        });

        return () => {
          unsubscribeOrders();
          unsubscribeMarketplaces();
        };
      } else {
        setLoading(false);
      }
    }
  }, [isAuthReady, db, userId, getOrderCollectionRef, getMarketplaceCollectionRef]);

  // --- 4. Lógica de Filtrado y Búsqueda ---

  const filteredOrders = useMemo(() => {
    // 1. Aplicar filtro de estado
    let currentOrders = filter === 'all' 
      ? orders 
      : orders.filter(order => order.status === filter);

    // 2. Aplicar búsqueda
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      currentOrders = currentOrders.filter(order => 
        order.order_id.toLowerCase().includes(searchLower) ||
        order.customer_name.toLowerCase().includes(searchLower) ||
        order.marketplace.toLowerCase().includes(searchLower)
      );
    }

    // 3. Ordenar (por fecha de pedido, más reciente primero)
    // NOTA: Ordenar en el cliente (en memoria) para evitar errores de índice en Firestore
    return currentOrders.sort((a, b) => b.order_date.getTime() - a.order_date.getTime());
  }, [orders, filter, searchTerm]);

  // --- 5. Funciones CRUD para Pedidos (Colaborativo) ---

  const handleUpdateStatus = async (orderId, newStatus) => {
    const orderDocRef = doc(db, getOrderCollectionRef().path, orderId);
    try {
      await updateDoc(orderDocRef, { 
        status: newStatus,
        updated_by: userId,
        updated_at: new Date()
      });
      // Mensaje de éxito en consola o UI
      console.log(`Estado del pedido ${orderId} actualizado a ${newStatus}`);
    } catch (e) {
      console.error("Error actualizando estado:", e);
      setError(`Fallo al actualizar el estado: ${e.message}`);
    }
  };

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm("¿Está seguro de que desea eliminar este pedido? Esta acción es irreversible.")) {
      return; // Usar modal personalizado en producción, pero confirm en desarrollo
    }
    const orderDocRef = doc(db, getOrderCollectionRef().path, orderId);
    try {
      await deleteDoc(orderDocRef);
      console.log(`Pedido ${orderId} eliminado.`);
    } catch (e) {
      console.error("Error eliminando pedido:", e);
      setError(`Fallo al eliminar el pedido: ${e.message}`);
    }
  };

  // --- 6. Componente de Adición de Pedidos (Simulación de Sincronización) ---

  const AddOrderForm = () => {
    const [isAdding, setIsAdding] = useState(false);
    const [formData, setFormData] = useState({
      order_id: '',
      customer_name: '',
      marketplace: '',
      amount: '',
      status: 'new',
    });

    const handleChange = (e) => {
      const { name, value } = e.target;
      setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleAddOrder = async (e) => {
      e.preventDefault();
      setIsAdding(true);
      const newOrder = {
        ...formData,
        amount: parseFloat(formData.amount),
        order_date: new Date(),
        created_by: userId,
        updated_by: userId,
        source: formData.marketplace,
        // Generar un ID simple si falta (simulación)
        order_id: formData.order_id || `ORD-${Math.floor(Math.random() * 100000)}`,
        // Simular ítems básicos
        items: [{ name: "Producto X", qty: 1 }],
      };

      try {
        await addDoc(getOrderCollectionRef(), newOrder);
        // Limpiar formulario y mostrar éxito
        setFormData({ order_id: '', customer_name: '', marketplace: '', amount: '', status: 'new' });
        console.log("Pedido agregado con éxito.");
      } catch (e) {
        console.error("Error al agregar pedido:", e);
        setError(`Fallo al agregar pedido: ${e.message}`);
      } finally {
        setIsAdding(false);
      }
    };

    return (
      <div className="p-4 bg-gray-50 rounded-lg shadow-inner">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Simular Sincronización de Nuevo Pedido</h3>
        {linkedMarketplaces.length === 0 ? (
          <p className="text-red-500 mb-4">
            ⚠️ No hay Marketplaces vinculados. No se puede simular la sincronización.
            <a href="/public/marketplace_admin_panel.html" target="_blank" className="text-blue-600 hover:underline ml-2">Vincular Marketplaces</a>.
          </p>
        ) : (
          <form onSubmit={handleAddOrder} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="text" name="order_id" placeholder="ID del Pedido (Ej. ML-1234)" value={formData.order_id} onChange={handleChange} required className="p-2 border border-gray-300 rounded-lg focus:ring-blue-500" />
              <input type="text" name="customer_name" placeholder="Nombre del Cliente" value={formData.customer_name} onChange={handleChange} required className="p-2 border border-gray-300 rounded-lg focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select name="marketplace" value={formData.marketplace} onChange={handleChange} required className="p-2 border border-gray-300 rounded-lg focus:ring-blue-500">
                    <option value="" disabled>Marketplace Origen</option>
                    {linkedMarketplaces.map(m => (
                        <option key={m.id} value={m.marketplace}>{m.marketplace} ({m.nickname})</option>
                    ))}
                </select>
                <input type="number" name="amount" placeholder="Monto Total ($)" value={formData.amount} onChange={handleChange} required className="p-2 border border-gray-300 rounded-lg focus:ring-blue-500" />
                <select name="status" value={formData.status} onChange={handleChange} required className="p-2 border border-gray-300 rounded-lg focus:ring-blue-500">
                    {STATUS_OPTIONS.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                </select>
            </div>
            <button type="submit" disabled={isAdding} className={`w-full p-3 rounded-lg font-bold transition ${isAdding ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {isAdding ? 'Sincronizando...' : 'Simular Sincronización de Nuevo Pedido'}
            </button>
          </form>
        )}
      </div>
    );
  };

  // --- 7. Renderizado Principal ---

  if (loading || !isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <svg className="animate-spin h-10 w-10 text-blue-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-4 text-lg text-gray-600">Cargando dashboard y autenticando...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-100 border-l-4 border-red-500 text-red-700 min-h-screen">
        <p className="font-bold">Error Crítico:</p>
        <p>{error}</p>
        <p className="mt-4 text-sm text-red-500">Si el error persiste, revise la configuración de Firebase y los logs de la consola.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
      <header className="mb-6 bg-white p-4 rounded-xl shadow-lg flex justify-between items-center flex-wrap">
        <h1 className="text-3xl font-extrabold text-gray-900">Dashboard de Despacho Colaborativo</h1>
        <div className="text-sm text-gray-600 mt-2 sm:mt-0">
          <p className="font-semibold">ID de Usuario: <span className="text-blue-600">{userId || 'Anónimo'}</span></p>
          <p>Marketplaces Vinculados: <span className="font-bold text-green-600">{linkedMarketplaces.length}</span></p>
        </div>
      </header>

      {/* Formulario de Adición de Pedido */}
      <AddOrderForm />

      {/* Controles de Filtrado y Búsqueda */}
      <div className="mt-6 p-4 bg-white rounded-xl shadow-lg flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
        <input 
          type="text" 
          placeholder="Buscar por ID, Cliente o Marketplace..." 
          value={searchTerm} 
          onChange={(e) => setSearchTerm(e.target.value)} 
          className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-blue-500"
        />
        
        <select 
          value={filter} 
          onChange={(e) => setFilter(e.target.value)} 
          className="p-3 border border-gray-300 rounded-lg focus:ring-blue-500 min-w-[200px]"
        >
          <option value="all">Todos los Estados ({orders.length})</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s.value} value={s.value}>
              {s.label} ({orders.filter(o => o.status === s.value).length})
            </option>
          ))}
        </select>
      </div>

      {/* Lista de Pedidos */}
      <main className="mt-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Pedidos Pendientes ({filteredOrders.length})</h2>
        
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-lg border-2 border-dashed border-gray-300">
            <p className="text-lg text-gray-600">No hay pedidos que coincidan con los filtros aplicados.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map(order => (
              <div key={order.id} className="bg-white p-4 rounded-xl shadow-md hover:shadow-lg transition flex flex-col lg:flex-row justify-between items-start lg:items-center space-y-3 lg:space-y-0">
                
                {/* Detalles del Pedido */}
                <div className="flex-1 min-w-0 pr-4">
                  <p className="text-lg font-extrabold text-gray-900 truncate">
                    {getStatusDetails(order.status).icon} {order.order_id} 
                    <span className="text-sm font-medium text-blue-600 ml-2">({order.marketplace})</span>
                  </p>
                  <p className="text-gray-700 font-semibold mt-1">
                    Cliente: {order.customer_name}
                  </p>
                  <p className="text-sm text-gray-500">
                    Monto: <span className="font-bold text-green-600">${order.amount?.toFixed(2) || 'N/A'}</span> | 
                    Fecha: {order.order_date.toLocaleDateString()}
                  </p>
                </div>
                
                {/* Controles de Estado y Acción */}
                <div className="flex flex-col sm:flex-row items-stretch lg:items-center space-y-2 sm:space-y-0 sm:space-x-3 w-full lg:w-auto">
                  
                  {/* Selector de Estado */}
                  <select
                    value={order.status}
                    onChange={(e) => handleUpdateStatus(order.id, e.target.value)}
                    className={`p-2 border border-gray-300 rounded-lg font-semibold w-full sm:w-auto ${getStatusDetails(order.status).color} text-white transition duration-200`}
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s.value} value={s.value} className="bg-white text-gray-900">
                        {s.label}
                      </option>
                    ))}
                  </select>

                  {/* Botón de Eliminar */}
                  <button
                    onClick={() => handleDeleteOrder(order.id)}
                    className="p-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition w-full sm:w-auto flex items-center justify-center"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Enlace al Panel de Integración */}
      <footer className="mt-8 text-center">
        <a href="/public/marketplace_admin_panel.html" target="_blank" className="text-sm text-gray-600 hover:text-blue-600 hover:underline transition">
          Configurar Marketplaces Vinculados (Abrir Panel de Administración)
        </a>
      </footer>
    </div>
  );
};

export default App;

                                     
