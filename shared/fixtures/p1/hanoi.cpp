#include <iostream>
void hanoi(int n, int from, int to, int spare) {
    if (n <= 0) { return; }
    hanoi(n - 1, from, spare, to);
    std::cout << from << "->" << to << "\n";
    hanoi(n - 1, spare, to, from);
}
int main() {
    int n;
    std::cin >> n;
    hanoi(n, 1, 3, 2);
    return 0;
}
