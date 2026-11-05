#include <iostream>
void dfs(int graph[], int seen[], int n, int current) {
    seen[current] = 1; std::cout << current << " ";
    for (int next = 0; next < n; next = next + 1) {
        if (graph[current * n + next] > 0 && seen[next] == 0) { dfs(graph, seen, n, next); }
    }
}

int main() {
    int n; int edges; int start; int mode;
    std::cin >> n >> edges >> start >> mode;
    int graph[36] = {};
    for (int edge = 0; edge < edges; edge = edge + 1) {
        int u; int v; int weight; std::cin >> u >> v >> weight;
        graph[u * n + v] = weight;
        graph[v * n + u] = weight;
    }
    int seen[6] = {}; int queue[6] = {}; int front = 0; int rear = 0;
    // 开始观察算法
    if (mode == 2) { dfs(graph, seen, n, start); }
    else {
        seen[start] = 1; queue[rear] = start; rear = rear + 1;
        while (front < rear) {
            int current = queue[front]; front = front + 1; std::cout << current << " ";
            for (int next = 0; next < n; next = next + 1) {
                if (graph[current * n + next] > 0 && seen[next] == 0) {
                    seen[next] = 1; queue[rear] = next; rear = rear + 1;
                }
            }
        }
    }
    std::cout << "\n";
    return 0;
}
