import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged 
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    query, 
    onSnapshot, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc, 
    setLogLevel 
} from 'firebase/firestore';

// SVG del logo JGV SOLUTIONS codificado en Base64.
// Es una representación fiel de la imagen que adjuntó.
const JGV_LOGO_SVG = `
<svg width="240" height="240" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="240" height="240" rx="30" fill="transparent"/>
  
  <!-- Fondo blanco redondeado (similar al chip/placa) -->
  <rect x="30" y="50" width="180" height="130" rx="15" fill="white" stroke="#00A99D" stroke-width="2"/>
  
  <!-- Texto Principal JGV -->
  <text x="120" y="105" text-anchor="middle" font-family="Arial, sans-serif" font-size="50" font-weight="bold" fill="#00A99D">JGV</text>
  
  <!-- Texto Secundario SOLUTIONS -->
  <text x="120" y="150" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="normal" fill="#00A99D">SOLUTIONS</text>

  <!-- Elementos de Circuito (Turquesa) -->
  <polyline points="20 70 30 70 30 60" stroke="#00A99D" stroke-width="3" fill="none" stroke-linejoin="round"/>
  <circle cx="20" cy="70" r="5" fill="#00A99D"/>

  <polyline points="220 70 210 70 210 60" stroke="#00A99D" stroke-width="3" fill="none" stroke-linejoin="round"/>
  <circle cx="220" cy="70" r="5" fill="#00A99D"/>
  
  <polyline points="20 160 30 160 30 170" stroke="#00A99D" stroke-width="3" fill="none" stroke-linejoin="round"/>
  <circle cx="20" cy="160" r="5" fill="#00A99D"/>

  <polyline points="220 160 210 160 210 170" stroke="#00A99D" stroke-width="3" fill="none" stroke-linejoin="round"/>
  <circle cx="220" cy="160" r="5" fill="#00A99D"/>

  <!-- Línea decorativa central (circuito) -->
  <line x1="60" y1="130" x2="180" y2="130" stroke="#00A99D" stroke-width="1.5" stroke-dasharray="3 3"/>

</svg>
`;

// Función para convertir SVG a una URL de datos (data URL)
const svgToDataURL = (svg) => `data:image/svg+xml;base64,${btoa(svg)}`;


// --- Definición de Variables de Entorno Globales con Fallback para APK ---
const appId = 
    typeof window !== 'undefined' && typeof window.__app_id !== 'undefined' 
        ? window.__app_id 
        : 'default-app-id';

// *IMPORTANTE: Añadir un objeto vacío como fallback para que la app inicie
// cuando se compila en un APK sin la configuración de Firebase inyectada.*
const firebaseConfig = 
    typeof window !== 'undefined' && typeof window.__firebase_config !== 'undefined'
        ? JSON.parse(window.__firebase_config)
        : {}; // Fallback: Objeto vacío para que la app no falle al iniciar

const initialAuthToken = 
    typeof window !== 'undefined' && typeof window.__initial_auth_token !== 'undefined'
        ? window.__initial_auth_token
        : null;


// --- Constantes de la Aplicación ---
const COLLECTION_NAME = 'orders'; 

// --- Componente de la Aplicación ---
const App = () => {
    // --- Estados de la Aplicación ---
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(true); 
    const [error, setError] = useState(null);
    const [isFirebaseReady, setIsFirebaseReady] = useState(false); // Nuevo estado de control
    
    // Estado para el manejo de formularios de nueva orden
    const [newOrder, setNewOrder] = useState({ 
        customerName: '', 
        item: '', 
        quantity: 1, 
        status: 'Pending' 
    });

    // --- Efecto de Inicialización y Autenticación de Firebase ---
    useEffect(() => {
        // Chequeo si la configuración de Firebase es válida (para este entorno)
        const isConfigValid = Object.keys(firebaseConfig).length > 0 && 
                              firebaseConfig.apiKey && 
                              firebaseConfig.projectId;

        if (!isConfigValid) {
            // Este bloque se ejecuta cuando se compila el APK
            console.warn("Firebase: Configuración ausente. La base de datos no estará activa.");
            setError("Modo Offline: Base de datos no disponible. La app iniciará, pero las funciones de DB no funcionarán.");
            setIsLoading(false);
            setIsFirebaseReady(false); // Marca Firebase como NO listo
            return;
        }
        
        // --- Proceso de Inicialización normal cuando la configuración SÍ está presente ---
        setLogLevel('debug');
        
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const authInstance = getAuth(app); 
            
            setDb(firestoreDb);

            const handleAuth = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authInstance, initialAuthToken);
                        console.log("Firebase: Signed in with custom token.");
                    } else {
                        await signInAnonymously(authInstance);
                        console.log("Firebase: Signed in anonymously.");
                    }
                } catch (e) {
                    console.error("Firebase Auth Error:", e);
                    setError(`Error de autenticación: ${e.message}`);
                }
            };
            
            const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                if (user) {
                    setUserId(user.uid);
                    console.log(`Firebase: User ID set to ${user.uid}`);
                } else {
                    setUserId(null); 
                    console.log("Firebase: User logged out/not found.");
                }
                setIsFirebaseReady(true); // Marca Firebase como listo
                setIsLoading(false);
            });

            handleAuth();
            
            return () => unsubscribe();
            
        } catch (e) {
            console.error("Firebase Init Error:", e);
            setError("Error al inicializar Firebase. Ver consola para más detalles.");
            setIsLoading(false);
            setIsFirebaseReady(false);
        }
    }, []); // Se ejecuta solo una vez al montar

    // --- Efecto para Suscripción a Firestore (onSnapshot) ---
    useEffect(() => {
        // Ejecutar solo si Firebase está listo Y la configuración es válida
        if (!isFirebaseReady || !db || !userId) {
            console.log("Firestore subscription skipped: Firebase not ready or missing config.");
            return;
        }

        const path = `artifacts/${appId}/users/${userId}/${COLLECTION_NAME}`;
        const q = query(collection(db, path));

        console.log(`Firestore: Subscribing to path: ${path}`);
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const fetchedOrders = [];
            querySnapshot.forEach((doc) => {
                fetchedOrders.push({ id: doc.id, ...doc.data() });
            });
            fetchedOrders.sort((a, b) => a.customerName.localeCompare(b.customerName));
            setOrders(fetchedOrders);
            console.log("Firestore: Data updated.");
        }, (err) => {
            console.error("Firestore Snapshot Error:", err);
            // No sobrescribir errores críticos anteriores, pero registrar este.
            if (isFirebaseReady) {
                // Solo registramos errores de snapshot si pensamos que DB debería estar funcionando
                console.error("Error de sincronización con Firestore.");
            }
        });

        return () => unsubscribe();
        
    }, [db, userId, isFirebaseReady]); // Depende de db, userId, y si Firebase se inicializó con éxito

    // --- Handlers de Formulario y Operaciones CRUD ---
    const checkDbStatus = () => {
        if (!isFirebaseReady) {
            alert("FUNCIÓN BLOQUEADA: La base de datos no está disponible. Este modo ocurre al ejecutar el APK sin configurar Firebase.");
            return false;
        }
        return true;
    };
    
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setNewOrder(prev => ({ 
            ...prev, 
            [name]: name === 'quantity' ? Number(value) : value 
        }));
    };

    const addOrder = async (e) => {
        e.preventDefault();
        if (!checkDbStatus() || !newOrder.customerName || !newOrder.item) return;

        const path = `artifacts/${appId}/users/${userId}/${COLLECTION_NAME}`;
        
        try {
            await addDoc(collection(db, path), {
                ...newOrder,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            setNewOrder({ customerName: '', item: '', quantity: 1, status: 'Pending' });
        } catch (e) {
            console.error("Error al agregar documento: ", e);
            // Reemplazar alert() con un modal/mensaje custom si fuera necesario
            alert("Error al guardar la orden. Ver consola."); 
        }
    };

    const updateOrderStatus = async (id, newStatus) => {
        if (!checkDbStatus()) return;

        const path = `artifacts/${appId}/users/${userId}/${COLLECTION_NAME}`;
        const docRef = doc(db, path, id);

        try {
            await updateDoc(docRef, { 
                status: newStatus,
                updatedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error("Error al actualizar documento: ", e);
            alert("Error al actualizar el estado de la orden. Ver consola.");
        }
    };

    const deleteOrder = async (id) => {
        if (!checkDbStatus()) return;
        
        const path = `artifacts/${appId}/users/${userId}/${COLLECTION_NAME}`;
        const docRef = doc(db, path, id);

        try {
            await deleteDoc(docRef);
        } catch (e) {
            console.error("Error al eliminar documento: ", e);
            alert("Error al eliminar la orden. Ver consola.");
        }
    };


    // --- Renderizado Condicional: PANTALLA DE CARGA PERSONALIZADA (Splash) ---
    if (isLoading) {
        // Estilos para replicar el color turquesa (#21B3A9) y el diseño centrado de la imagen
        return (
            <div className="flex flex-col items-center justify-center min-h-screen" style={{ backgroundColor: '#21B3A9' }}>
                <div className="text-center p-4">
                    
                    {/* Contenedor del Logo con efecto borroso de fondo */}
                    <div className="relative w-40 h-40 mx-auto mb-10">
                        <div className="absolute inset-0 bg-white opacity-20 rounded-full blur-xl scale-110"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <img 
                                src={svgToDataURL(JGV_LOGO_SVG)} 
                                alt="Logo JGV Solutions" 
                                className="w-full h-full object-contain rounded-xl shadow-lg"
                            />
                        </div>
                    </div>

                    {/* Nombre y Versión de la App */}
                    <h1 className="text-4xl font-extrabold text-white mb-2 tracking-wide">
                        MultiMarket-Pro
                    </h1>
                    <p className="text-white text-lg mb-10 opacity-75">
                        v1.0.0
                    </p>

                    {/* Spinner de Carga */}
                    <div className="animate-spin rounded-full h-10 w-10 border-4 border-t-4 border-white border-opacity-75 mx-auto"></div>
                    
                    {/* Mensaje de Inicialización */}
                    <p className="mt-8 text-white text-xl font-semibold">
                        Inicializando...
                    </p>
                </div>
            </div>
        );
    }
    
    // --- Renderizado de Error o Advertencia de Modo Offline ---
    const ShowErrorOrWarning = ({ message }) => (
        <div className="fixed top-0 left-0 right-0 p-3 text-center bg-yellow-500 text-white font-bold shadow-lg z-50">
            {message}
        </div>
    );

    // --- Componente de Tarjeta de Orden ---
    const OrderCard = ({ order }) => {
        let statusColor = 'bg-gray-500';
        let buttonText = 'Mark as Processing';
        let nextStatus = 'Processing';

        switch (order.status) {
            case 'Pending':
                statusColor = 'bg-yellow-500';
                buttonText = 'Marcar en Proceso';
                nextStatus = 'Processing';
                break;
            case 'Processing':
                statusColor = 'bg-blue-500';
                buttonText = 'Marcar como Enviado';
                nextStatus = 'Shipped';
                break;
            case 'Shipped':
                statusColor = 'bg-green-500';
                buttonText = 'Marcar como Entregado';
                nextStatus = 'Delivered';
                break;
            case 'Delivered':
                statusColor = 'bg-green-700';
                buttonText = 'Completado';
                nextStatus = 'Delivered'; 
                break;
            default:
                break;
        }

        const canAdvanceStatus = order.status !== 'Delivered';

        return (
            <div className="bg-white p-4 rounded-lg shadow-xl border-t-4 border-gray-200 flex flex-col justify-between h-full">
                <div>
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-xl font-bold text-gray-800 break-words pr-2">{order.customerName}</h3>
                        <span className={`px-3 py-1 text-xs font-semibold text-white rounded-full ${statusColor}`}>
                            {order.status}
                        </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-1">
                        <span className="font-medium">Artículo:</span> {order.item}
                    </p>
                    <p className="text-sm text-gray-600 mb-4">
                        <span className="font-medium">Cantidad:</span> {order.quantity}
                    </p>
                </div>

                <div className="mt-auto">
                    {canAdvanceStatus && (
                        <button
                            onClick={() => updateOrderStatus(order.id, nextStatus)}
                            className="w-full mb-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
                        >
                            {buttonText}
                        </button>
                    )}
                    {!canAdvanceStatus && (
                        <div className="w-full text-center text-sm py-2 px-4 text-green-700 bg-green-100 rounded-lg mb-2">
                            Orden completada.
                        </div>
                    )}
                    <button
                        onClick={() => deleteOrder(order.id)}
                        className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200 text-sm"
                    >
                        Eliminar Orden
                    </button>
                </div>
            </div>
        );
    };


    // --- Renderizado Principal (Dashboard) ---
    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-6 md:p-8">
            
            {/* Mostrar el mensaje de advertencia si la DB no está activa */}
            {!isFirebaseReady && error && <ShowErrorOrWarning message={error} />}

            <header className="mb-8 text-center">
                <h1 className="text-4xl font-extrabold text-gray-900 mb-2">Panel de Gestión de Órdenes</h1>
                <p className="text-gray-600 text-lg">
                    App ID: <span className="font-mono bg-gray-200 px-2 py-0.5 rounded text-sm">{appId}</span>
                </p>
                <p className="text-gray-600 text-lg">
                    User ID: <span className="font-mono bg-gray-200 px-2 py-0.5 rounded text-sm">{userId || 'N/A'}</span>
                </p>
            </header>

            {/* Formulario para Añadir Orden */}
            <div className="max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-2xl mb-8">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-2">Añadir Nueva Orden</h2>
                <form onSubmit={addOrder} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <input
                        type="text"
                        name="customerName"
                        value={newOrder.customerName}
                        onChange={handleInputChange}
                        placeholder="Nombre del Cliente"
                        required
                        className="col-span-4 md:col-span-1 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    />
                    <input
                        type="text"
                        name="item"
                        value={newOrder.item}
                        onChange={handleInputChange}
                        placeholder="Artículo del Pedido"
                        required
                        className="col-span-4 md:col-span-1 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    />
                    <input
                        type="number"
                        name="quantity"
                        value={newOrder.quantity}
                        onChange={handleInputChange}
                        min="1"
                        placeholder="Cantidad"
                        required
                        className="col-span-2 md:col-span-1 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                        type="submit"
                        disabled={!newOrder.customerName || !newOrder.item || !isFirebaseReady}
                        className="col-span-2 md:col-span-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition duration-200 disabled:bg-green-300"
                    >
                        Crear Orden
                    </button>
                </form>
            </div>

            {/* Lista de Órdenes */}
            <section className="max-w-6xl mx-auto">
                <h2 className="text-3xl font-bold text-gray-800 mb-6">Órdenes Activas ({orders.length})</h2>
                {orders.length === 0 && isFirebaseReady ? (
                    <div className="text-center p-10 bg-white rounded-xl shadow-md">
                        <p className="text-xl text-gray-500">No hay órdenes pendientes. ¡Añade una nueva!</p>
                    </div>
                ) : orders.length === 0 && !isFirebaseReady ? (
                    <div className="text-center p-10 bg-red-100 text-red-700 rounded-xl shadow-md border border-red-300">
                        <p className="text-xl font-bold mb-2">Base de Datos Desconectada</p>
                        <p className="text-lg">No se pudo cargar la lista de órdenes porque la configuración de Firebase está ausente (modo APK).</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {orders.map(order => (
                            <OrderCard key={order.id} order={order} />
                        ))}
                    </div>
                )}
    
