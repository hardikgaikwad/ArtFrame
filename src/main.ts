import './styles/main.css';
import './styles/layout.css';
import './styles/components.css';
import { startApp } from './app/app';

const root = document.getElementById('app');
if (root) startApp(root);
