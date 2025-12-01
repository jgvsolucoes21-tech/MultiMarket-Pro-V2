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
// Este SVG es una representación fiel de la imagen del logo adjunta,
// incluyendo la forma de chip blanco y los detalles de circuito turquesa.
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


// --- Definición de Variables de Entorno Globales para evitar no-undef ---
const appId = 
    typeof window !== 'undefined' && typeof window.__app_id !== 'undefined' 
        ? window.__app_id 
        : 'default-app-id';

const firebaseConfig = 
    typeof window !== 'undefined' && typeof window.__firebase_config !== 'undefined'
        ? JSON.parse(window.__firebase_config)
        : {};

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
    
    // Estado para el manejo de formularios de nueva orden
    const [newOrder, setNewOrder] = useState({ 
        customerName: '', 
        item: '', 
        quantity: 1, 
        status: 'Pending' 
    });

    // --- Efecto de Inicialización y Autenticación de Firebase ---
    useEffect(() => {
        // Chequeo de configuración crítica
        if (Object.keys(firebaseConfig).length === 0) {
            setError("Error: La configuración de Firebase está ausente o no se pudo cargar.");
            setIsLoading(false);
            return;
        }

        setLogLevel('debug');
        
        // 1. Inicializar Firebase
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const authInstance = getAuth(app); 
            
            setDb(firestoreDb);

            // 2. Manejar la Autenticación
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
                    setError("Error de autenticación. Ver consola para más detalles.");
                }
            };
            
            // 3. Establecer el observador de estado de autenticación
            const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                if (user) {
                    setUserId(user.uid);
                    console.log(`Firebase: User ID set to ${user.uid}`);
                } else {
                    setUserId(null); // Usuario desconectado
                    console.log("Firebase: User logged out/not found.");
                }
                // Desactivar la pantalla de carga después de la primera comprobación de auth
                setIsLoading(false);
            });

            // Iniciar el proceso de autenticación
            handleAuth();
            
            // Cleanup: Desuscribirse del observador de auth al desmontar
            return () => unsubscribe();
            
        } catch (e) {
            console.error("Firebase Init Error:", e);
            setError("Error al inicializar Firebase. Ver consola para más detalles.");
            setIsLoading(false);
        }
    }, []); // Se ejecuta solo una vez al montar

    // --- Efecto para Suscripción a Firestore (onSnapshot) ---
    useEffect(() => {
        // Ejecutar solo si Firebase y el userId están listos
        if (!db || !userId) {
            console.log("Firestore subscription skipped: DB or User ID not ready.");
            return;
        }

        // Definir la ruta de la colección privada del usuario
        // /artifacts/{appId}/users/{userId}/orders
        const path = `artifacts/${appId}/users/${userId}/${COLLECTION_NAME}`;
        const q = query(collection(db, path));

        console.log(`Firestore: Subscribing to path: ${path}`);
        
        // Suscripción en tiempo real a la colección
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const fetchedOrders = [];
            querySnapshot.forEach((doc) => {
                fetchedOrders.push({ id: doc.id, ...doc.data() });
            });
            // Ordenar por nombre del cliente para consistencia (en memoria)
            fetchedOrders.sort((a, b) => a.customerName.localeCompare(b.customerName));
            setOrders(fetchedOrders);
            console.log("Firestore: Data updated.");
        }, (err) => {
            console.error("Firestore Snapshot Error:", err);
            setError("Error de sincronización con Firestore. Ver consola.");
        });

        // Cleanup: Desuscribirse al desmontar o si cambian las dependencias
        return () => unsubscribe();
        
    }, [db, userId]); // Depende de db y userId

    // --- Handlers de Formulario y Operaciones CRUD (omitted for brevity, same as previous version) ---
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setNewOrder(prev => ({ 
            ...prev, 
            [name]: name === 'quantity' ? Number(value) : value 
        }));
    };

    const addOrder = async (e) => {
        e.preventDefault();
        if (!db || !userId || !newOrder.customerName || !newOrder.item) return;

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
            setError("Error al guardar la orden.");
        }
    };

    const updateOrderStatus = async (id, newStatus) => {
        if (!db || !userId) return;

        const path = `artifacts/${appId}/users/${userId}/${COLLECTION_NAME}`;
        const docRef = doc(db, path, id);

        try {
            await updateDoc(docRef, { 
                status: newStatus,
                updatedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error("Error al actualizar documento: ", e);
            setError("Error al actualizar el estado de la orden.");
        }
    };

    const deleteOrder = async (id) => {
        if (!db || !userId) return;
        
        const path = `artifacts/${appId}/users/${userId}/${COLLECTION_NAME}`;
        const docRef = doc(db, path, id);

        try {
            await deleteDoc(docRef);
        } catch (e) {
            console.error("Error al eliminar documento: ", e);
            setError("Error al eliminar la orden.");
        }
    };


    // --- Renderizado Condicional: PANTALLA DE CARGA PERSONALIZADA (Splash) ---
    if (isLoading) {
        // Estilos para replicar el color turquesa (#21B3A9) y el diseño centrado de la imagen
        return (
            <div className="flex flex-col items-center justify-center min-h-screen" style={{ backgroundColor: '#21B3A9' }}>
                <div className="text-center p-4">
                    
                    {/* Logo JGV SOLUTIONS usando Data URL de SVG */}
                    <div className="relative w-40 h-40 mx-auto mb-10">
                        {/* Fondo circular borroso replicando el efecto de la imagen */}
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

                    {/* Spinner de Carga (similar al círculo vacío) */}
                    <div className="animate-spin rounded-full h-10 w-10 border-4 border-t-4 border-white border-opacity-75 mx-auto"></div>
                    
                    {/* Mensaje de Inicialización */}
                    <p className="mt-8 text-white text-xl font-semibold">
                        Inicializando...
                    </p>
                </div>
            </div>
        );
    }
    
    // --- Renderizado de Error (Mantenido) ---
    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-900 text-white p-4">
                <div className="text-center p-6 bg-red-800 rounded-xl shadow-2xl">
                    <h1 className="text-2xl font-bold mb-4">¡Error Crítico!</h1>
                    <p className="mb-4">No se pudo inicializar la aplicación o autenticar el usuario.</p>
                    <p className="font-mono text-sm break-all">{error}</p>
                    <p className="mt-4 text-sm">Verifique la consola del navegador o los logs del dispositivo para detalles.</p>
                </div>
            </div>
        );
    }

    // --- Componente de Tarjeta de Orden (Mantenido) ---
    const OrderCard = ({ order }) => {
        // Lógica de color basada en el estado
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
                nextStatus = 'Delivered'; // No cambia más
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
                        disabled={!newOrder.customerName || !newOrder.item}
                        className="col-span-2 md:col-span-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition duration-200 disabled:bg-green-300"
                    >
                        Crear Orden
                    </button>
                </form>
            </div>

            {/* Lista de Órdenes */}
            <section className="max-w-6xl mx-auto">
                <h2 className="text-3xl font-bold text-gray-800 mb-6">Órdenes Activas ({orders.length})</h2>
                {orders.length === 0 ? (
                    <div className="text-center p-10 bg-white rounded-xl shadow-md">
                        <p className="text-xl text-gray-500">No hay órdenes pendientes. ¡Añade una nueva!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {orders.map(order => (
                            <OrderCard key={order.id} order={order} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export default App;

            
