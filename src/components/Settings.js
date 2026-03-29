'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';

const GROUP_LABELS = { women: 'Ladies', kids: 'Kids', men: 'Gents', other: 'Other' };

export default function Settings() {
  const [tab, setTab] = useState('team');

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">Settings</h2>

      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg">
        {[
          { id: 'team', label: 'Sales Team' },
          { id: 'categories', label: 'Categories' },
          { id: 'admin', label: 'Admin' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'team' && <SalesTeamSettings />}
      {tab === 'categories' && <CategorySettings />}
      {tab === 'admin' && <AdminSettings />}
    </div>
  );
}

function SalesTeamSettings() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPin, setEditPin] = useState('');
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');

  const fetchUsers = () => {
    setLoading(true);
    api.getUsers()
      .then(d => setUsers(d.users.filter(u => u.role === 'salesman')))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createUser({ name: newName, role: 'salesman', pin: newPin });
      setShowAdd(false);
      setNewName('');
      setNewPin('');
      fetchUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (u) => {
    setEditingId(u.id);
    setEditName(u.name);
    setEditPin(u.pin || '');
  };

  const saveEdit = async () => {
    setError('');
    try {
      await api.updateUser(editingId, { name: editName, pin: editPin });
      setEditingId(null);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.updateUser(u.id, { active: !u.active });
      fetchUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (u) => {
    if (!confirm(`${u.name} ko delete karna hai?`)) return;
    try {
      await api.deleteUser(u.id);
      fetchUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">Loading...</div>;

  return (
    <div>
      {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-500">Sales Team Members</h3>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-xs py-1.5 px-3">
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card mb-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Naam"
            className="input"
            required
          />
          <input
            type="text"
            value={newPin}
            onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4-digit PIN"
            className="input"
            maxLength={4}
            required
          />
          <button type="submit" className="btn-primary w-full text-sm">Save</button>
        </form>
      )}

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="card">
            {editingId === u.id ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="input text-sm"
                />
                <input
                  type="text"
                  value={editPin}
                  onChange={e => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="4-digit PIN"
                  className="input text-sm"
                  maxLength={4}
                />
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="btn-primary text-xs flex-1">Save</button>
                  <button onClick={() => setEditingId(null)} className="btn-secondary text-xs flex-1">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className={`font-medium ${!u.active ? 'text-gray-400 line-through' : ''}`}>
                    {u.name}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">PIN: {u.pin}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(u)}
                    className="text-xs px-2 py-1 rounded text-blue-600 hover:bg-blue-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(u)}
                    className={`text-xs px-2 py-1 rounded-full ${
                      u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {u.active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    onClick={() => handleDelete(u)}
                    className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {users.length === 0 && (
          <div className="text-center py-4 text-gray-400 text-sm">Koi salesman nahi hai. Add karo.</div>
        )}
      </div>
    </div>
  );
}

function CategorySettings() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState('women');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');

  const fetchCategories = () => {
    setLoading(true);
    api.getCategories(true)
      .then(d => setCategories(d.categories))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createCategory({ name: newName, group_name: newGroup });
      setShowAdd(false);
      setNewName('');
      setNewGroup('women');
      fetchCategories();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveEdit = async (id) => {
    setError('');
    try {
      await api.updateCategory(id, { name: editName });
      setEditingId(null);
      fetchCategories();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleActive = async (cat) => {
    try {
      await api.updateCategory(cat.id, { active: !cat.active });
      fetchCategories();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">Loading...</div>;

  const groups = ['women', 'men', 'kids', 'other'];

  return (
    <div>
      {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-500">Product Categories</h3>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-xs py-1.5 px-3">
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card mb-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Category naam (jaise Sharara, Suit Set)"
            className="input"
            required
          />
          <select
            value={newGroup}
            onChange={e => setNewGroup(e.target.value)}
            className="input"
          >
            {groups.map(g => (
              <option key={g} value={g}>{GROUP_LABELS[g]}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary w-full text-sm">Save</button>
        </form>
      )}

      {groups.map(group => {
        const groupCats = categories.filter(c => c.group_name === group);
        if (groupCats.length === 0) return null;
        return (
          <div key={group} className="mb-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {GROUP_LABELS[group]}
            </h4>
            <div className="space-y-1">
              {groupCats.map(cat => (
                <div key={cat.id} className="card py-2">
                  {editingId === cat.id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="input text-sm flex-1"
                      />
                      <button onClick={() => saveEdit(cat.id)} className="btn-primary text-xs">Save</button>
                      <button onClick={() => setEditingId(null)} className="btn-secondary text-xs">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className={`font-medium text-sm ${!cat.active ? 'text-gray-400 line-through' : ''}`}>
                        {cat.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                          className="text-xs px-2 py-1 rounded text-blue-600 hover:bg-blue-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(cat)}
                          className={`text-xs px-2 py-1 rounded-full ${
                            cat.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {cat.active ? 'Active' : 'Inactive'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdminSettings() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchAdmins = () => {
    setLoading(true);
    api.getUsers()
      .then(d => setAdmins(d.users.filter(u => u.role === 'admin')))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAdmins(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createUser({ name: newName, role: 'admin', username: newUsername, password: newPassword });
      setShowAdd(false);
      setNewName('');
      setNewUsername('');
      setNewPassword('');
      fetchAdmins();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (u) => {
    setEditingId(u.id);
    setEditName(u.name);
    setEditUsername(u.username || '');
    setEditPassword('');
    setError('');
    setSuccess('');
  };

  const saveEdit = async () => {
    setError('');
    setSuccess('');
    const updates = { name: editName, username: editUsername };
    if (editPassword) updates.password = editPassword;
    try {
      await api.updateUser(editingId, updates);
      setEditingId(null);
      setSuccess('Admin update ho gaya');
      fetchAdmins();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">Loading...</div>;

  return (
    <div>
      {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
      {success && <div className="mb-3 p-2 bg-green-50 text-green-700 rounded text-sm">{success}</div>}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-500">Admin Accounts</h3>
        <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }} className="btn-primary text-xs py-1.5 px-3">
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card mb-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Naam"
            className="input"
            required
          />
          <input
            type="text"
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            placeholder="Username"
            className="input"
            required
          />
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Password"
            className="input"
            required
          />
          <button type="submit" className="btn-primary w-full text-sm">Save</button>
        </form>
      )}

      <div className="space-y-2">
        {admins.map(u => (
          <div key={u.id} className="card">
            {editingId === u.id ? (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Naam</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="input text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Username</label>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={e => setEditUsername(e.target.value)}
                    className="input text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Naya Password (khali chodo agar change nahi karna)</label>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                    placeholder="Naya password"
                    className="input text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="btn-primary text-xs flex-1">Save</button>
                  <button onClick={() => setEditingId(null)} className="btn-secondary text-xs flex-1">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{u.name}</span>
                  <span className="text-xs text-gray-400 ml-2">@{u.username}</span>
                </div>
                <button
                  onClick={() => startEdit(u)}
                  className="text-xs px-2 py-1 rounded text-blue-600 hover:bg-blue-50"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h4 className="text-sm font-medium text-gray-600 mb-2">App Info</h4>
        <div className="text-xs text-gray-500 space-y-1">
          <p>Master Ji Fashion House</p>
          <p>Shastri Nagar, Ghaziabad</p>
          <p>Version 1.0.0</p>
        </div>
      </div>
    </div>
  );
}
