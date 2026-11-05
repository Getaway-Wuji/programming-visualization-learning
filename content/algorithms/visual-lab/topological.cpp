#include <iostream>

int main() {
    int n; int edges; int start; int mode;
    std::cin >> n >> edges >> start >> mode;
    int graph[36] = {};
    for (int edge = 0; edge < edges; edge = edge + 1) {
        int u; int v; int weight; std::cin >> u >> v >> weight;
        graph[u * n + v] = weight;
        // UNDIRECTED
    }
    int indegree[6] = {}; int seen[6] = {}; int queue[6] = {};
    // 开始观察算法
    for (int u = 0; u < n; u = u + 1) {
        for (int v = 0; v < n; v = v + 1) { if (graph[u * n + v] > 0) { indegree[v] = indegree[v] + 1; } }
    }
    int front = 0; int rear = 0;
    for (int u = 0; u < n; u = u + 1) { if (indegree[u] == 0) { queue[rear] = u; rear = rear + 1; } }
    while (front < rear) {
        int current = queue[front]; front = front + 1; seen[current] = 1; std::cout << current << " ";
        for (int v = 0; v < n; v = v + 1) {
            if (graph[current * n + v] > 0) {
                indegree[v] = indegree[v] - 1;
                if (indegree[v] == 0) { queue[rear] = v; rear = rear + 1; }
            }
        }
    }
    if (rear < n) { std::cout << "cycle"; }
    std::cout << "\n";
    return 0;
}
